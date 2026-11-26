/**
 * Superadmin AI bug triage: settings, buckets, chat, platform AI keys.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { AI_PROVIDER_IDS } from "@/lib/ai/credentials";
import {
  clearPlatformProvider,
  getPlatformAiSettingsView,
  savePlatformProviderKeys,
} from "@/lib/ai/platform-credentials";
import { assertSafeRemoteUrl } from "@/lib/network-security";
import { bugTriageChat } from "@/lib/bug-triage/chat";
import { getBugBucketDetail, listBugBuckets } from "@/lib/bug-triage/list";
import { loadBugTriageSettings, saveBugTriageSettings } from "@/lib/bug-triage/settings";
import { BUG_SEVERITIES } from "@/lib/bug-triage/types";
import { writePlatformAudit } from "../tenant";
import { platformProcedure, router } from "../trpc";

const providerIdSchema = z.enum(AI_PROVIDER_IDS);

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

export const bugTriageRouter = router({
  settingsGet: platformProcedure.query(() => loadBugTriageSettings()),

  settingsSet: platformProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        errorThreshold: z.number().int().min(1).max(10_000).optional(),
        noiseThreshold: z.number().int().min(1).max(10_000).optional(),
        windowDays: z.number().int().min(1).max(90).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const saved = await saveBugTriageSettings(input);
        await writePlatformAudit(ctx.supabase, {
          actorId: ctx.user.id,
          action: "bug_triage.settings",
          targetType: "bug_triage_settings",
          targetId: "1",
          meta: input,
        });
        return saved;
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Could not save settings.",
        });
      }
    }),

  bucketsList: platformProcedure
    .input(
      z
        .object({
          severity: z.enum(BUG_SEVERITIES).optional(),
          hasIssue: z.boolean().optional(),
          search: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(({ input }) => listBugBuckets(input ?? {})),

  bucketGet: platformProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const detail = await getBugBucketDetail(input.id);
    if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Bucket not found." });
    return detail;
  }),

  chat: platformProcedure
    .input(
      z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(4000),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .mutation(({ input }) => bugTriageChat(input.messages)),

  /** Platform LLM keys used by triage/chat when no org context (env is fallback). */
  platformAiGet: platformProcedure.query(async () => {
    try {
      return await getPlatformAiSettingsView();
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Could not load platform AI keys.",
      });
    }
  }),

  platformAiSaveKeys: platformProcedure
    .input(
      z.object({
        providerId: providerIdSchema,
        keySlots: z.array(z.string().max(500)).max(5),
        baseUrl: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.providerId === "custom") await validateCustomBaseUrl(input.baseUrl);
        await savePlatformProviderKeys({
          providerId: input.providerId,
          keySlots: input.keySlots,
          baseUrl: input.providerId === "custom" ? input.baseUrl : undefined,
        });
        await writePlatformAudit(ctx.supabase, {
          actorId: ctx.user.id,
          action: "platform_ai.save_keys",
          targetType: "platform_ai_providers",
          targetId: input.providerId,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Could not save platform AI keys.",
        });
      }
    }),

  platformAiClearProvider: platformProcedure
    .input(z.object({ providerId: providerIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await clearPlatformProvider(input.providerId);
        await writePlatformAudit(ctx.supabase, {
          actorId: ctx.user.id,
          action: "platform_ai.clear_provider",
          targetType: "platform_ai_providers",
          targetId: input.providerId,
        });
        return { ok: true };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Could not clear provider.",
        });
      }
    }),
});
