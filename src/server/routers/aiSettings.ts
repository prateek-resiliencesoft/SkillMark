import {
  AI_PROVIDER_IDS,
  AI_TASK_KINDS,
  isSttProvider,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_TASK_ROUTING,
  MAX_KEYS_PER_PROVIDER,
  applyProviderModelsPatch,
  applyKeyOrderPatch,
  applyKeySlotsPatch,
  defaultModelForProvider,
  getStoredRouting,
  getStoredTaskModels,
  loadOrgAiProvidersRaw,
  maskAiProviders,
  mergeAiProvidersPatch,
  sanitizeTaskModels,
  type AiProviderId,
  type AiRoutingStored,
  type AiTaskKind,
  type AiTaskModelsStored,
  decryptAiProviders,
} from "@/lib/ai/credentials";
import { checkVoiceModel, voiceBlockedReason } from "@/lib/ai/capabilities";
import { listProviderModels } from "@/lib/ai/list-models";
import { loadCatalogRows, loadUsdInr, upsertListedModels, withInrEstimate } from "@/lib/ai/studio/catalog";
import { STUDIO_MODULES } from "@/lib/ai/studio/modules";
import { estimateWorkloadUsd, formatInr } from "@/lib/ai/studio/pricing";
import { rankModelsForTask, suggestionStrip } from "@/lib/ai/studio/suitability";
import {
  aggregateAiUsage,
  resolveUsageRange,
  type AiRunRow,
  type UsagePeriod,
} from "@/lib/ai/studio/usage-aggregate";
import { langfuseTraceUrl } from "@/lib/ai/tracing";
import type { ReasoningStep } from "@/lib/ai/graph/types";
import { assertSafeRemoteUrl } from "@/lib/network-security";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isPlatformAdmin } from "../tenant";
import { assertMinRole, getOrgMembership, hasMinRole, protectedProcedure, router } from "../trpc";

async function requireOrgAdmin(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  userId: string,
) {
  if (await isPlatformAdmin(supabase, userId)) return;
  const membership = await getOrgMembership(supabase, organizationId, userId, { write: true });
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  assertMinRole(membership.role, "ADMIN");
}

/** Tenant LLM endpoints must be public https hosts (SSRF); blank clears. */
async function validateCustomBaseUrl(baseUrl: string | null | undefined): Promise<void> {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return;
  try {
    const url = await assertSafeRemoteUrl(trimmed);
    if (url.hash) throw new Error("URL must not contain a fragment");
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Custom endpoint URL is not allowed: ${(err as Error).message}. Use a public https:// address.`,
    });
  }
}

const providerIdSchema = z.enum(AI_PROVIDER_IDS);
const taskKindSchema = z.enum(AI_TASK_KINDS);

export const aiSettingsRouter = router({
  get: protectedProcedure.input(z.object({ organizationId: z.string() })).query(async ({ ctx, input }) => {
    if (!(await isPlatformAdmin(ctx.supabase, ctx.user.id))) {
      const membership = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
    }

    const raw = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
    const masked = maskAiProviders(raw);
    const plain = decryptAiProviders(raw);
    const storedRouting = getStoredRouting(raw);
    const taskModels = getStoredTaskModels(raw);
    const routing = Object.fromEntries(
      AI_TASK_KINDS.map((kind) => [kind, storedRouting[kind] ?? DEFAULT_TASK_ROUTING[kind]]),
    ) as Record<AiTaskKind, AiProviderId[]>;

    return {
      providers: AI_PROVIDER_IDS.map((id) => ({
        id,
        apiKeyHint: masked[id].apiKeyHint,
        apiKeyHints: masked[id].apiKeyHints,
        keyCount: masked[id].keyCount,
        keyTiers: masked[id].keyTiers,
        maxKeys: MAX_KEYS_PER_PROVIDER,
        baseUrl: id === "custom" ? masked[id].baseUrl : undefined,
        textModel: plain[id]?.textModel ?? "",
        voiceModel: id === "custom" ? plain.custom?.voiceModel ?? "" : undefined,
        defaultModel: defaultModelForProvider(id),
        configured: masked[id].keyCount > 0 || (id === "custom" && !!masked[id].baseUrl),
      })),
      routing,
      taskModels,
      modules: STUDIO_MODULES,
      defaultRouting: DEFAULT_TASK_ROUTING,
      defaultModels: DEFAULT_PROVIDER_MODELS,
      taskKinds: AI_TASK_KINDS,
      envFallback: {
        openai: !!process.env.OPENAI_API_KEY,
        gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        nvidia: !!(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
        custom: !!(process.env.CUSTOM_LLM_BASE_URL || process.env.CUSTOM_LLM_API_KEY),
      },
    };
  }),

  /** Save one provider's key slots (up to 5). Empty slot = keep existing. */
  saveProviderKeys: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        providerId: providerIdSchema,
        /** Legacy: plaintext slots; "" keeps existing key at that index. */
        keySlots: z.array(z.string().max(500)).max(MAX_KEYS_PER_PROVIDER).optional(),
        /** Ordered slots (drag-to-reorder): keep a saved key by old index and/or set a new value. */
        slots: z
          .array(
            z.object({
              keep: z.number().int().min(0).max(MAX_KEYS_PER_PROVIDER - 1).nullish(),
              value: z.string().max(500).optional(),
              tier: z.enum(["free", "paid"]).optional(),
            }),
          )
          .max(MAX_KEYS_PER_PROVIDER)
          .optional(),
        baseUrl: z.string().max(500).nullable().optional(),
        /** Default chat model for this provider. */
        textModel: z.string().max(200).nullable().optional(),
        /** Custom endpoint only — realtime voice model. */
        voiceModel: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const baseUrl = input.providerId === "custom" ? input.baseUrl : undefined;
      await validateCustomBaseUrl(baseUrl);
      let next = input.slots
        ? applyKeyOrderPatch(current, input.providerId, input.slots, baseUrl)
        : applyKeySlotsPatch(current, input.providerId, input.keySlots ?? [], baseUrl);
      if (input.textModel !== undefined || (input.providerId === "custom" && input.voiceModel !== undefined)) {
        const models = applyProviderModelsPatch(next, input.providerId, {
          textModel: input.textModel,
          voiceModel: input.providerId === "custom" ? input.voiceModel : undefined,
        });
        if (models.error) throw new TRPCError({ code: "BAD_REQUEST", message: models.error });
        next = models.next;
      }
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  /** Clear all keys for a provider. */
  clearProvider: protectedProcedure
    .input(z.object({ organizationId: z.string(), providerId: providerIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(current, {
        [input.providerId]: { apiKeys: [], baseUrl: input.providerId === "custom" ? null : undefined },
      });
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  /** Save task → ordered provider list (first = primary, rest = backups). */
  saveRouting: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        routing: z.record(taskKindSchema, z.array(providerIdSchema).max(AI_PROVIDER_IDS.length)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const routing = input.routing as AiRoutingStored;
      for (const pid of routing.round2_transcript ?? []) {
        if (!isSttProvider(pid)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Round 2 transcript needs a speech-to-text provider (Groq, OpenAI or Custom)." });
        }
      }
      // Voice interviews only run on voice-capable providers.
      for (const pid of routing.voice ?? []) {
        const blocked = voiceBlockedReason(pid);
        if (blocked) throw new TRPCError({ code: "BAD_REQUEST", message: blocked });
        if (pid === "custom") {
          const check = checkVoiceModel(decryptAiProviders(current).custom?.voiceModel);
          if (!check.ok) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Custom endpoint can't be used for voice: ${check.reason}`,
            });
          }
        }
      }
      const next = mergeAiProvidersPatch(current, {}, routing);
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  /** Save Studio task → provider+model failover hops (also syncs routing). */
  saveTaskModels: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // Partial map — only customized tasks; sanitizeTaskModels drops unknown keys.
        taskModels: z
          .record(
            z.string(),
            z
              .array(
                z.object({
                  provider: providerIdSchema,
                  model: z.string().trim().min(1).max(200),
                }),
              )
              .max(12),
          )
          .default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const cleaned = sanitizeTaskModels(input.taskModels);
      for (const hop of cleaned.voice ?? []) {
        const blocked = voiceBlockedReason(hop.provider);
        if (blocked) throw new TRPCError({ code: "BAD_REQUEST", message: blocked });
      }
      for (const hop of cleaned.round2_transcript ?? []) {
        if (!isSttProvider(hop.provider)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Transcript hops need Groq, OpenAI, or Custom.",
          });
        }
      }
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(current, {}, undefined, cleaned);
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true, taskModels: getStoredTaskModels(next) };
    }),

  /** Catalog + ₹ estimates + cheap→best suggestions for one module/task. */
  listCatalog: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        task: taskKindSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!(await isPlatformAdmin(ctx.supabase, ctx.user.id))) {
        const membership = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
        if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }
      const { usdInr, asOf } = await loadUsdInr();
      const rows = await loadCatalogRows();
      const mod = STUDIO_MODULES.find((m) => m.task === input.task);
      const workload = mod?.workload ?? { kind: "text" as const, inputTokens: 8_000, outputTokens: 1_500 };
      const ranked = input.task
        ? rankModelsForTask(rows, input.task, workload)
        : rows.map((m) => ({ ...m, estimateUsd: estimateWorkloadUsd(m, workload), rankLabel: "other" as const }));
      const withInr = ranked.map((m) => {
        const row = withInrEstimate(m, m.estimateUsd, usdInr);
        return {
          ...row,
          rankLabel: m.rankLabel,
          estimateUsd: m.estimateUsd,
          estimateInrLabel: row.estimateInr != null ? formatInr(row.estimateInr) : "₹ unknown",
        };
      });
      return {
        usdInr,
        pricesAsOf: asOf,
        models: withInr,
        suggestions: input.task ? suggestionStrip(ranked).map((m) => m.modelId) : [],
        modules: STUDIO_MODULES,
      };
    }),

  /** Validate key + list live models into catalog. */
  testProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        providerId: providerIdSchema,
        /** Optional draft key (unsaved) — used when testing before Save. */
        apiKey: z.string().max(500).optional(),
        /** Optional draft base URL for Custom. */
        baseUrl: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const plain = decryptAiProviders(await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId));
      const key = input.apiKey?.trim() || plain[input.providerId]?.apiKeys?.[0];
      if (!key) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add an API key for this provider first." });
      }
      const baseUrl =
        input.providerId === "custom"
          ? input.baseUrl?.trim() || plain.custom?.baseUrl || undefined
          : plain[input.providerId]?.baseUrl;
      if (input.providerId === "custom" && input.baseUrl !== undefined) {
        await validateCustomBaseUrl(input.baseUrl);
      }
      try {
        const listed = await listProviderModels({
          provider: input.providerId,
          apiKey: key,
          baseUrl,
        });
        const upserted = await upsertListedModels(input.providerId, listed);
        return { ok: true as const, count: listed.length, upserted, models: listed.slice(0, 100) };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not list models: ${(err as Error).message}`,
        });
      }
    }),

  /** Org-wide AI spend / tokens from `ai_runs` + catalog rates (₹ estimate). */
  usageDashboard: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        period: z.enum(["last7", "last30", "thisMonth"]).default("last30"),
      }),
    )
    .query(async ({ ctx, input }) => {
      let canSeeTraces = false;
      if (!(await isPlatformAdmin(ctx.supabase, ctx.user.id))) {
        const membership = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
        if (!membership) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
        }
        canSeeTraces = hasMinRole(membership.role, "ADMIN");
      } else {
        canSeeTraces = true;
      }
      const period = input.period as UsagePeriod;
      const range = resolveUsageRange(period);
      const [{ usdInr, asOf }, catalog, runsRes] = await Promise.all([
        loadUsdInr(),
        loadCatalogRows(),
        supabaseAdmin
          .from("ai_runs")
          .select(
            'id, flow, status, tokens, steps, "startedAt", "endedAt", error, "subjectType", "subjectId", "traceId"',
          )
          .eq("organizationId", input.organizationId)
          .gte("startedAt", range.start.toISOString())
          .lte("startedAt", range.end.toISOString())
          .order("startedAt", { ascending: false })
          .limit(2500),
      ]);
      const raw = runsRes.error ? [] : (runsRes.data ?? []);
      const traceById = new Map(
        raw.map((r) => [r.id as string, (r.traceId as string | null) ?? null] as const),
      );
      const runs: AiRunRow[] = raw.map((r) => ({
        id: r.id as string,
        flow: (r.flow as string) ?? "unknown",
        status: (r.status as string) ?? "done",
        tokens: Number(r.tokens) || 0,
        steps: (r.steps as ReasoningStep[] | null) ?? null,
        startedAt: r.startedAt as string,
        endedAt: (r.endedAt as string | null) ?? null,
        error: (r.error as string | null) ?? null,
        subjectType: (r.subjectType as string | null) ?? null,
        subjectId: (r.subjectId as string | null) ?? null,
      }));
      const aggregated = aggregateAiUsage(runs, catalog, usdInr, range);
      return {
        period,
        range: { start: range.start.toISOString(), end: range.end.toISOString() },
        usdInr,
        pricesAsOf: asOf,
        estimateNote:
          "₹ cost counts paid keys only (free-tier keys show tokens at ₹0). Formula: (input / 1M) × ₹-per-MTok_in + (output / 1M) × ₹-per-MTok_out (catalog USD × FX). Env/platform keys count as paid. Legacy runs without key-tier metadata are treated as paid.",
        ...aggregated,
        recent: aggregated.recent.map((r) => ({
          ...r,
          traceUrl: canSeeTraces ? langfuseTraceUrl(traceById.get(r.id)) : null,
        })),
      };
    }),

  listSuggestedPresets: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!(await isPlatformAdmin(ctx.supabase, ctx.user.id))) {
        const membership = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
        if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }
      const { data, error } = await supabaseAdmin
        .from("ai_preset_templates")
        .select("id, slug, name, blurb, payload, \"updatedAt\"")
        .eq("published", true)
        .order("name");
      if (error) return [];
      return data ?? [];
    }),

  applyPreset: protectedProcedure
    .input(z.object({ organizationId: z.string(), presetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const { data: preset, error: pErr } = await supabaseAdmin
        .from("ai_preset_templates")
        .select("payload, published")
        .eq("id", input.presetId)
        .maybeSingle();
      if (pErr || !preset?.published) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found." });
      }
      const payload = (preset.payload ?? {}) as { taskModels?: AiTaskModelsStored; routing?: AiRoutingStored };
      const cleaned = sanitizeTaskModels(payload.taskModels ?? {});
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(
        current,
        {},
        payload.routing ?? undefined,
        Object.keys(cleaned).length ? cleaned : null,
      );
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true, taskModels: getStoredTaskModels(next) };
    }),

  /** Legacy single-key save (still used by older clients). */
  save: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        providers: z
          .object({
            openai: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
            gemini: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
            nvidia: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
            anthropic: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
            groq: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
            custom: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const providers = { ...(input.providers ?? {}) };
      for (const id of ["openai", "gemini", "nvidia", "anthropic", "groq"] as const) {
        if (providers[id]) providers[id] = { ...providers[id], baseUrl: undefined };
      }
      await validateCustomBaseUrl(providers.custom?.baseUrl);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(current, providers);
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),
});
