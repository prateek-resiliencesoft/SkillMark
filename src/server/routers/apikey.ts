import { z } from "zod";
import { router, protectedProcedure, getOrgMembership } from "../trpc";
import { API_KEY_SCOPES, generateApiKey } from "@/lib/api-keys";
import { TRPCError } from "@trpc/server";

const LIST_COLUMNS = "id, name, keyPrefix, environment, scopes, organizationId, isActive, lastUsedAt, expiresAt, revokedAt, createdAt";

export const apiKeyRouter = router({
  /** Never returns secrets — only a display prefix. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("api_keys")
      .select(LIST_COLUMNS)
      .eq("userId", ctx.user.id)
      .order("createdAt", { ascending: false });
    return (data ?? []).map((k: Record<string, unknown>) => ({ ...k, maskedKey: `${(k.keyPrefix as string) ?? "dlv_"}…` }));
  }),

  /** Returns the plaintext key exactly once; only its SHA-256 hash is stored. */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        expiresAt: z.string().datetime().optional(),
        environment: z.enum(["test", "live"]).default("live"),
        scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).default(["*"]),
        organizationId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.organizationId) {
        const m = await getOrgMembership(ctx.supabase, input.organizationId, ctx.user.id);
        if (!m) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }
      const { key, hash, prefix } = generateApiKey(input.environment);
      const { data: apiKey, error } = await ctx.supabase
        .from("api_keys")
        .insert({
          userId: ctx.user.id,
          name: input.name,
          keyHash: hash,
          keyPrefix: prefix,
          environment: input.environment,
          scopes: input.scopes,
          organizationId: input.organizationId ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .select("id")
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { id: apiKey.id as string, key };
    }),

  /** Revoke the old key and issue a new one with the same settings. */
  rotate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: old } = await ctx.supabase
        .from("api_keys")
        .select("id, name, environment, scopes, organizationId, expiresAt")
        .eq("id", input.id)
        .eq("userId", ctx.user.id)
        .single();
      if (!old) throw new TRPCError({ code: "NOT_FOUND" });
      const { key, hash, prefix } = generateApiKey(old.environment === "test" ? "test" : "live");
      const { data: created, error } = await ctx.supabase
        .from("api_keys")
        .insert({
          userId: ctx.user.id,
          name: old.name,
          keyHash: hash,
          keyPrefix: prefix,
          environment: old.environment,
          scopes: old.scopes,
          organizationId: old.organizationId,
          expiresAt: old.expiresAt,
        })
        .select("id")
        .single();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      await ctx.supabase.from("api_keys").update({ isActive: false, revokedAt: new Date().toISOString() }).eq("id", old.id);
      return { id: created.id as string, key };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("api_keys")
        .select("id")
        .eq("id", input.id)
        .eq("userId", ctx.user.id)
        .single();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await ctx.supabase
        .from("api_keys")
        .update({ isActive: false, revokedAt: new Date().toISOString() })
        .eq("id", input.id);

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.supabase
        .from("api_keys")
        .delete()
        .eq("id", input.id)
        .eq("userId", ctx.user.id);
      return { success: true };
    }),
});
