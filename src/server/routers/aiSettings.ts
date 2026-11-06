import {
  AI_PROVIDER_IDS,
  AI_TASK_KINDS,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_TASK_ROUTING,
  MAX_KEYS_PER_PROVIDER,
  applyCustomModelsPatch,
  applyKeyOrderPatch,
  applyKeySlotsPatch,
  defaultModelForProvider,
  getStoredRouting,
  loadOrgAiProvidersRaw,
  maskAiProviders,
  mergeAiProvidersPatch,
  type AiProviderId,
  type AiRoutingStored,
  type AiTaskKind,
  decryptAiProviders,
} from "@/lib/ai/credentials";
import { checkVoiceModel, voiceBlockedReason } from "@/lib/ai/capabilities";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isPlatformAdmin } from "../tenant";
import { assertMinRole, getOrgMembership, protectedProcedure, router } from "../trpc";

async function requireOrgAdmin(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  userId: string,
) {
  if (await isPlatformAdmin(supabase, userId)) return;
  const membership = await getOrgMembership(supabase, organizationId, userId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  assertMinRole(membership.role, "ADMIN");
}

const providerIdSchema = z.enum(["openai", "gemini", "nvidia", "anthropic", "custom"]);
const taskKindSchema = z.enum([
  "screening",
  "standard",
  "heavy",
  "interview",
  "report",
  "resume",
  "generate",
  "voice",
]);

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
    const routing = Object.fromEntries(
      AI_TASK_KINDS.map((kind) => [kind, storedRouting[kind] ?? DEFAULT_TASK_ROUTING[kind]]),
    ) as Record<AiTaskKind, AiProviderId[]>;

    return {
      providers: AI_PROVIDER_IDS.map((id) => ({
        id,
        apiKeyHint: masked[id].apiKeyHint,
        apiKeyHints: masked[id].apiKeyHints,
        keyCount: masked[id].keyCount,
        maxKeys: MAX_KEYS_PER_PROVIDER,
        baseUrl: id === "custom" ? masked[id].baseUrl : undefined,
        textModel: id === "custom" ? plain.custom?.textModel ?? "" : undefined,
        voiceModel: id === "custom" ? plain.custom?.voiceModel ?? "" : undefined,
        defaultModel: defaultModelForProvider(id),
        configured: masked[id].keyCount > 0 || (id === "custom" && !!masked[id].baseUrl),
      })),
      routing,
      defaultRouting: DEFAULT_TASK_ROUTING,
      defaultModels: DEFAULT_PROVIDER_MODELS,
      taskKinds: AI_TASK_KINDS,
      envFallback: {
        openai: !!process.env.OPENAI_API_KEY,
        gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        nvidia: !!(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
        anthropic: !!process.env.ANTHROPIC_API_KEY,
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
            }),
          )
          .max(MAX_KEYS_PER_PROVIDER)
          .optional(),
        baseUrl: z.string().max(500).nullable().optional(),
        /** Custom endpoint only. */
        textModel: z.string().max(200).nullable().optional(),
        voiceModel: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const baseUrl = input.providerId === "custom" ? input.baseUrl : undefined;
      let next = input.slots
        ? applyKeyOrderPatch(current, input.providerId, input.slots, baseUrl)
        : applyKeySlotsPatch(current, input.providerId, input.keySlots ?? [], baseUrl);
      if (input.providerId === "custom") {
        const models = applyCustomModelsPatch(next, {
          textModel: input.textModel,
          voiceModel: input.voiceModel,
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
            custom: z.object({ apiKey: z.string().max(500).nullable().optional(), baseUrl: z.string().max(500).nullable().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(current, input.providers ?? {});
      const { error } = await ctx.supabase.from("org_integrations").upsert(
        { organizationId: input.organizationId, aiProviders: next },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),
});
