import {
  AI_PROVIDER_IDS,
  loadOrgAiProvidersRaw,
  maskAiProviders,
  mergeAiProvidersPatch,
} from "@/lib/ai/credentials";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertMinRole, getOrgMembership, protectedProcedure, router } from "../trpc";

async function requireOrgAdmin(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  userId: string,
) {
  const membership = await getOrgMembership(supabase, organizationId, userId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  assertMinRole(membership.role, "ADMIN");
}

const providerPatch = z.object({
  apiKey: z.string().max(500).nullable().optional(),
  baseUrl: z.string().max(500).nullable().optional(),
});

export const aiSettingsRouter = router({
  get: protectedProcedure.input(z.object({ organizationId: z.string() })).query(async ({ ctx, input }) => {
    const membership = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
    if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });

    const raw = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
    const masked = maskAiProviders(raw);

    return {
      providers: AI_PROVIDER_IDS.map((id) => ({
        id,
        apiKeyHint: masked[id].apiKeyHint,
        baseUrl: id === "custom" ? masked[id].baseUrl : undefined,
        configured: !!masked[id].apiKeyHint || (id === "custom" && !!masked[id].baseUrl),
      })),
      envFallback: {
        openai: !!process.env.OPENAI_API_KEY,
        gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        nvidia: !!(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        custom: !!(process.env.CUSTOM_LLM_BASE_URL || process.env.CUSTOM_LLM_API_KEY),
      },
    };
  }),

  save: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        providers: z
          .object({
            openai: providerPatch.optional(),
            gemini: providerPatch.optional(),
            nvidia: providerPatch.optional(),
            anthropic: providerPatch.optional(),
            custom: providerPatch.optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const current = await loadOrgAiProvidersRaw(ctx.supabase, input.organizationId);
      const next = mergeAiProvidersPatch(current, input.providers ?? {});

      const { error } = await ctx.supabase.from("org_integrations").upsert(
        {
          organizationId: input.organizationId,
          aiProviders: next,
        },
        { onConflict: "organizationId" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),
});
