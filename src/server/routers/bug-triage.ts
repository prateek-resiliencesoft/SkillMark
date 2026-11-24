/**
 * Superadmin AI bug triage: settings, buckets, chat.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bugTriageChat } from "@/lib/bug-triage/chat";
import { getBugBucketDetail, listBugBuckets } from "@/lib/bug-triage/list";
import { loadBugTriageSettings, saveBugTriageSettings } from "@/lib/bug-triage/settings";
import { BUG_SEVERITIES } from "@/lib/bug-triage/types";
import { writePlatformAudit } from "../tenant";
import { platformProcedure, router } from "../trpc";

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
});
