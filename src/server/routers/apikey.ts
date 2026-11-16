import { z } from "zod";
import { router, protectedProcedure, getOrgMembership, assertMinRole } from "../trpc";
import type { Context } from "../context";
import { API_KEY_SCOPES, generateApiKey } from "@/lib/api-keys";
import type { MemberRole } from "../trpc";
import { TRPCError } from "@trpc/server";


/** Org API keys are managed by org admins and owners only. */
async function requireOrgAdmin(supabase: Context["supabase"], organizationId: string, userId: string) {
  const m = await getOrgMembership(supabase, organizationId, userId);
  if (!m) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  assertMinRole(m.role as MemberRole, "ADMIN");
}

async function insertOrgKey(
  supabase: Context["supabase"],
  row: Record<string, unknown>,
): Promise<string> {
  let res = await supabase.from("api_keys").insert(row).select("id").single();
  if (res.error && "createdBy" in row) {
    // Migration 29 adds createdBy; older databases still work without it.
    const { createdBy: _ignored, ...rest } = row;
    void _ignored;
    res = await supabase.from("api_keys").insert(rest).select("id").single();
  }
  if (res.error || !res.data) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: res.error?.message ?? "Could not create key" });
  return res.data.id as string;
}

const orgScopes = z.array(z.enum(API_KEY_SCOPES)).min(1);

const LIST_COLUMNS = "id, name, keyPrefix, environment, scopes, organizationId, isActive, lastUsedAt, expiresAt, revokedAt, createdAt";

export const apiKeyRouter = router({
  /** Never returns secrets — only a display prefix. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("api_keys")
      .select(LIST_COLUMNS)
      .eq("userId", ctx.user.id)
      .order("createdAt", { ascending: false });
    return (data ?? []).map((k: Record<string, unknown>) => ({ ...k, maskedKey: `${(k.keyPrefix as string) ?? "rsi_"}…` }));
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

  /* ---------- Organization keys (API section) ---------- */

  orgList: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const { data } = await ctx.supabase
        .from("api_keys")
        .select("*")
        .eq("organizationId", input.organizationId)
        .order("createdAt", { ascending: false });
      const rows = (data ?? []) as Record<string, unknown>[];
      const people = Array.from(new Set(rows.map((r) => (r.createdBy as string | undefined) ?? (r.userId as string))));
      const names: Record<string, string> = {};
      if (people.length) {
        const { data: profiles } = await ctx.supabase.from("profiles").select("id, name, email").in("id", people);
        for (const p of profiles ?? []) names[p.id as string] = (p.name as string) || (p.email as string);
      }
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        prefix: (r.keyPrefix as string | null) ?? null,
        environment: (r.environment as string) === "test" ? "test" : "live",
        scopes: (r.scopes as string[] | null) ?? ["*"],
        active: !!r.isActive && !r.revokedAt && !(r.expiresAt && new Date(r.expiresAt as string) < new Date()),
        revokedAt: (r.revokedAt as string | null) ?? null,
        expiresAt: (r.expiresAt as string | null) ?? null,
        lastUsedAt: (r.lastUsedAt as string | null) ?? null,
        createdAt: r.createdAt as string,
        createdBy: names[((r.createdBy as string | undefined) ?? (r.userId as string))] ?? null,
      }));
    }),

  orgCreate: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        environment: z.enum(["test", "live"]).default("live"),
        scopes: orgScopes,
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const { key, hash, prefix } = generateApiKey(input.environment);
      const id = await insertOrgKey(ctx.supabase, {
        userId: ctx.user.id,
        createdBy: ctx.user.id,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        environment: input.environment,
        scopes: input.scopes,
        organizationId: input.organizationId,
        expiresAt: input.expiresAt ?? null,
      });
      return { id, key };
    }),

  orgRevoke: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const { data, error } = await ctx.supabase
        .from("api_keys")
        .update({ isActive: false, revokedAt: new Date().toISOString() })
        .eq("id", input.id)
        .eq("organizationId", input.organizationId)
        .select("id")
        .maybeSingle();
      if (error || !data) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
      return { success: true };
    }),

  orgRotate: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const { data: old } = await ctx.supabase
        .from("api_keys")
        .select("id, name, environment, scopes, expiresAt")
        .eq("id", input.id)
        .eq("organizationId", input.organizationId)
        .maybeSingle();
      if (!old) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
      const { key, hash, prefix } = generateApiKey(old.environment === "test" ? "test" : "live");
      const id = await insertOrgKey(ctx.supabase, {
        userId: ctx.user.id,
        createdBy: ctx.user.id,
        name: old.name,
        keyHash: hash,
        keyPrefix: prefix,
        environment: old.environment,
        scopes: old.scopes,
        organizationId: input.organizationId,
        expiresAt: old.expiresAt,
      });
      await ctx.supabase.from("api_keys").update({ isActive: false, revokedAt: new Date().toISOString() }).eq("id", old.id);
      return { id, key };
    }),

  /** Recent API and MCP requests for the organization (no secrets, no bodies). */
  orgUsage: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await requireOrgAdmin(ctx.supabase, input.organizationId, ctx.user.id);
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const [{ data }, { count: day }, { count: dayErrors }] = await Promise.all([
        ctx.supabase.from("api_usage_logs").select("*").eq("organizationId", input.organizationId).order("createdAt", { ascending: false }).limit(input.limit),
        ctx.supabase.from("api_usage_logs").select("id", { count: "exact", head: true }).eq("organizationId", input.organizationId).gte("createdAt", since),
        ctx.supabase.from("api_usage_logs").select("id", { count: "exact", head: true }).eq("organizationId", input.organizationId).gte("createdAt", since).gte("status", 400),
      ]);
      return {
        last24h: day ?? 0,
        errors24h: dayErrors ?? 0,
        recent: (data ?? []).map((r) => ({
          id: String(r.id),
          apiKeyId: (r.apiKeyId as string | null) ?? null,
          method: r.method as string,
          endpoint: r.endpoint as string,
          status: r.status as number,
          durationMs: (r.durationMs as number | null | undefined) ?? null,
          createdAt: r.createdAt as string,
        })),
      };
    }),
});
