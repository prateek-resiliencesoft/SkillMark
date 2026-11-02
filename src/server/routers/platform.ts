/**
 * Platform (super-admin) operations.
 *
 * These endpoints manage every organization on the instance. They are gated by
 * `platformProcedure` (profiles.role = ADMIN). User-facing copy stays plain —
 * "pause", "plan", "people" — never tenant/IDOR jargon.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { platformProcedure, router } from "../trpc";
import {
  type OrgPlan,
  type OrgStatus,
  writePlatformAudit,
} from "../tenant";

const orgStatusEnum = z.enum(["ACTIVE", "SUSPENDED", "DELETED"]);
const orgPlanEnum = z.enum(["FREE", "PRO", "ENTERPRISE", "SELF_HOSTED"]);

const PLAN_LABEL: Record<OrgPlan, string> = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
  SELF_HOSTED: "Self-hosted",
};

const STATUS_LABEL: Record<OrgStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Paused",
  DELETED: "Removed",
};

export const platformRouter = router({
  /** Lightweight gate for the admin UI shell. */
  me: platformProcedure.query(async ({ ctx }) => {
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("id, email, name, role")
      .eq("id", ctx.user.id)
      .maybeSingle();

    return {
      id: ctx.user.id,
      email: profile?.email ?? ctx.user.email ?? null,
      name: profile?.name ?? null,
      role: "ADMIN" as const,
    };
  }),

  /** Aggregate counts for the control-center home. */
  overview: platformProcedure.query(async ({ ctx }) => {
    const [
      { count: orgCount },
      { count: pausedCount },
      { count: userCount },
      { count: sessionCount },
    ] = await Promise.all([
      ctx.supabase
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .neq("status", "DELETED"),
      ctx.supabase
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("status", "SUSPENDED"),
      ctx.supabase.from("profiles").select("id", { count: "exact", head: true }),
      ctx.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "IN_PROGRESS"),
    ]);

    return {
      organizations: orgCount ?? 0,
      paused: pausedCount ?? 0,
      people: userCount ?? 0,
      liveSessions: sessionCount ?? 0,
    };
  }),

  listOrganizations: platformProcedure
    .input(
      z
        .object({
          query: z.string().max(100).optional(),
          status: orgStatusEnum.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const q = input?.query?.trim();

      let req = ctx.supabase
        .from("organizations")
        .select(
          "id, name, slug, ownerId, status, plan, limits, featureFlags, createdAt, updatedAt",
          { count: "exact" },
        )
        .neq("status", "DELETED")
        .order("createdAt", { ascending: false })
        .range(offset, offset + limit - 1);

      if (input?.status) {
        req = req.eq("status", input.status);
      }
      if (q) {
        // PostgREST or() filter — name/slug ilike
        req = req.or(`name.ilike.%${q}%,slug.ilike.%${q}%`);
      }

      const { data, count, error } = await req;
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not load organizations.",
        });
      }

      const orgs = data ?? [];
      const ownerIds = Array.from(new Set(orgs.map((o) => o.ownerId as string)));
      const ownerMap: Record<string, { email: string; name: string | null }> = {};
      if (ownerIds.length > 0) {
        const { data: owners } = await ctx.supabase
          .from("profiles")
          .select("id, email, name")
          .in("id", ownerIds);
        for (const p of owners ?? []) {
          ownerMap[p.id as string] = {
            email: p.email as string,
            name: (p.name as string | null) ?? null,
          };
        }
      }

      // Member counts in one pass
      const orgIds = orgs.map((o) => o.id as string);
      const memberCounts: Record<string, number> = {};
      if (orgIds.length > 0) {
        const { data: members } = await ctx.supabase
          .from("organization_members")
          .select("organizationId")
          .in("organizationId", orgIds);
        for (const m of members ?? []) {
          const key = m.organizationId as string;
          memberCounts[key] = (memberCounts[key] ?? 0) + 1;
        }
      }

      return {
        total: count ?? orgs.length,
        items: orgs.map((o) => {
          const status = (o.status as OrgStatus) ?? "ACTIVE";
          const plan = (o.plan as OrgPlan) ?? "SELF_HOSTED";
          return {
            id: o.id as string,
            name: o.name as string,
            slug: o.slug as string,
            status,
            statusLabel: STATUS_LABEL[status],
            plan,
            planLabel: PLAN_LABEL[plan],
            memberCount: memberCounts[o.id as string] ?? 0,
            owner: ownerMap[o.ownerId as string] ?? null,
            createdAt: o.createdAt as string,
            updatedAt: o.updatedAt as string,
          };
        }),
      };
    }),

  getOrganization: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: org } = await ctx.supabase
        .from("organizations")
        .select(
          "id, name, slug, ownerId, status, plan, limits, featureFlags, createdAt, updatedAt",
        )
        .eq("id", input.id)
        .maybeSingle();

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      const [{ count: memberCount }, { count: projectCount }, { data: owner }] =
        await Promise.all([
          ctx.supabase
            .from("organization_members")
            .select("id", { count: "exact", head: true })
            .eq("organizationId", input.id),
          ctx.supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organizationId", input.id),
          ctx.supabase
            .from("profiles")
            .select("id, email, name")
            .eq("id", org.ownerId)
            .maybeSingle(),
        ]);

      const status = (org.status as OrgStatus) ?? "ACTIVE";
      const plan = (org.plan as OrgPlan) ?? "SELF_HOSTED";

      return {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        status,
        statusLabel: STATUS_LABEL[status],
        plan,
        planLabel: PLAN_LABEL[plan],
        limits: (org.limits as Record<string, unknown>) ?? {},
        featureFlags: (org.featureFlags as Record<string, unknown>) ?? {},
        memberCount: memberCount ?? 0,
        projectCount: projectCount ?? 0,
        owner: owner
          ? {
              id: owner.id as string,
              email: owner.email as string,
              name: (owner.name as string | null) ?? null,
            }
          : null,
        createdAt: org.createdAt as string,
        updatedAt: org.updatedAt as string,
      };
    }),

  setOrganizationStatus: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["ACTIVE", "SUSPENDED"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({ status: input.status })
        .eq("id", input.id)
        .neq("status", "DELETED")
        .select("id, name, status")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action:
          input.status === "SUSPENDED" ? "org.pause" : "org.resume",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, status: org.status },
      });

      const status = org.status as OrgStatus;
      return {
        id: org.id as string,
        status,
        statusLabel: STATUS_LABEL[status],
      };
    }),

  setOrganizationPlan: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        plan: orgPlanEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({ plan: input.plan })
        .eq("id", input.id)
        .neq("status", "DELETED")
        .select("id, name, plan")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.set_plan",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, plan: org.plan },
      });

      const plan = org.plan as OrgPlan;
      return {
        id: org.id as string,
        plan,
        planLabel: PLAN_LABEL[plan],
      };
    }),

  listPeople: platformProcedure
    .input(
      z
        .object({
          query: z.string().max(100).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const q = input?.query?.trim();

      let req = ctx.supabase
        .from("profiles")
        .select("id, email, name, role, createdAt", { count: "exact" })
        .order("createdAt", { ascending: false })
        .range(offset, offset + limit - 1);

      if (q) {
        req = req.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
      }

      const { data, count, error } = await req;
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not load people.",
        });
      }

      const people = data ?? [];
      const ids = people.map((p) => p.id as string);
      const membershipCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: memberships } = await ctx.supabase
          .from("organization_members")
          .select("userId")
          .in("userId", ids);
        for (const m of memberships ?? []) {
          const key = m.userId as string;
          membershipCounts[key] = (membershipCounts[key] ?? 0) + 1;
        }
      }

      return {
        total: count ?? people.length,
        items: people.map((p) => ({
          id: p.id as string,
          email: p.email as string,
          name: (p.name as string | null) ?? null,
          role: p.role as string,
          isPlatformAdmin: p.role === "ADMIN",
          organizationCount: membershipCounts[p.id as string] ?? 0,
          createdAt: p.createdAt as string,
        })),
      };
    }),

  recentAudit: platformProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 30;
      const { data } = await ctx.supabase
        .from("platform_audit_logs")
        .select("id, actorId, action, targetType, targetId, meta, createdAt")
        .order("createdAt", { ascending: false })
        .limit(limit);

      const rows = data ?? [];
      const actorIds = Array.from(new Set(rows.map((r) => r.actorId as string)));
      const actorMap: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: actors } = await ctx.supabase
          .from("profiles")
          .select("id, email, name")
          .in("id", actorIds);
        for (const a of actors ?? []) {
          actorMap[a.id as string] =
            (a.name as string) || (a.email as string) || "Someone";
        }
      }

      return rows.map((r) => ({
        id: r.id as string,
        action: r.action as string,
        targetType: r.targetType as string,
        targetId: (r.targetId as string | null) ?? null,
        meta: (r.meta as Record<string, unknown>) ?? {},
        actorName: actorMap[r.actorId as string] ?? "Someone",
        createdAt: r.createdAt as string,
      }));
    }),
});
