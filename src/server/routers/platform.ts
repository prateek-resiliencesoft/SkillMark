/**
 * Platform (super-admin) operations.
 *
 * These endpoints manage every organization on the instance. They are gated by
 * `platformProcedure` (profiles.role = ADMIN). User-facing copy stays plain —
 * "pause", "plan", "people" — never tenant/IDOR jargon.
 */
import { nanoid } from "@/lib/id";
import { clearStoredMedia } from "@/lib/media-review";
import { deleteAccount } from "@/lib/account-deletion";
import {
  getStorageConfigSummary,
  listObjectsWithMetadata,
  moveStoredObject,
  storage,
} from "@/lib/storage";
import {
  candidateFolderSlug,
  candidateMediaPrefix,
  mediaObjectKey,
} from "@/lib/storage-paths";
import { authDb } from "@/lib/supabase/admin";
import { setUserPaused } from "@/lib/users";
import {
  GRAFANA_LOG_SOURCES,
  queryGrafanaLinuxLogs,
  queryServerMetrics,
  type GrafanaLogSource,
} from "@/lib/grafana/client";
import {
  createUptimeMonitor,
  getUptimeStatus,
  invalidateUptimeCache,
} from "@/lib/uptime/client";
import {
  loadUptimeVisibility,
  saveUptimeVisibility,
  seedUptimeVisibilityIfNeeded,
} from "@/lib/uptime/visibility";
import {
  limitsFromCatalog,
  planIdOk,
  PROTECTED_PLAN_IDS,
  type PlanCatalogEntry,
} from "@/lib/billing/catalog";
import {
  parseDefaultFeatureFlags,
  parseInstanceSettings,
  parsePlanCatalog,
} from "@/lib/platform-settings";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  loadPlatformSettings,
  upsertPlatformSetting,
} from "../platform-settings";
import { platformProcedure, router } from "../trpc";
import {
  type OrgPlan,
  type OrgStatus,
  writePlatformAudit,
} from "../tenant";

const orgStatusEnum = z.enum(["ACTIVE", "SUSPENDED", "DELETED"]);
const limitValue = z.number().int().min(0).nullable();
const orgPlanId = z
  .string()
  .trim()
  .toUpperCase()
  .refine(planIdOk, "Plan id must be UPPER_SNAKE (A-Z, 0-9, underscore)");
const memberRoleEnum = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const platformRoleEnum = z.enum(["USER", "ADMIN", "ENTERPRISE"]);

const planFeatureFlagsSchema = z.object({
  aiSettings: z.boolean(),
  integrations: z.boolean(),
  voiceInterviews: z.boolean(),
  publicForms: z.boolean(),
  usageDashboard: z.boolean(),
});

const planCatalogEntrySchema = z.object({
  id: orgPlanId,
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(280).default(""),
  limits: z.object({
    seats: limitValue,
    interviews: limitValue,
    projects: limitValue,
  }),
  purchaseable: z.boolean(),
  stripePriceId: z.string().trim().max(120).nullable(),
  stripePriceEnv: z.string().trim().max(80).nullable(),
  features: planFeatureFlagsSchema,
});

const STATUS_LABEL: Record<OrgStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Paused",
  DELETED: "Removed",
};

const MEMBER_ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

const PLATFORM_ROLE_LABEL: Record<string, string> = {
  USER: "Standard",
  ADMIN: "Platform admin",
  ENTERPRISE: "Enterprise",
};

function planLabel(plan: string, catalog: PlanCatalogEntry[]): string {
  return catalog.find((p) => p.id === plan)?.name ?? plan;
}

/** ids → paused_at for the given users (auth schema). */
async function pausedMap(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await authDb.from("users").select("id, paused_at").in("id", ids);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; paused_at: string | null }[]) {
    if (r.paused_at) out[r.id] = r.paused_at;
  }
  return out;
}

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
        .order("createdAt", { ascending: false })
        .range(offset, offset + limit - 1);

      if (input?.status) {
        req = req.eq("status", input.status);
      } else {
        req = req.neq("status", "DELETED");
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
            planLabel: plan,
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
          "id, name, slug, ownerId, status, plan, limits, featureFlags, stripeCustomerId, stripeSubscriptionId, billingEmail, createdAt, updatedAt",
        )
        .eq("id", input.id)
        .maybeSingle();

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      const [
        { data: memberRows },
        { data: projectRows },
        { count: pendingInviteCount },
        { data: owner },
        { data: auditRows },
      ] = await Promise.all([
        ctx.supabase
          .from("organization_members")
          .select("id, userId, role, joinedAt")
          .eq("organizationId", input.id)
          .order("joinedAt", { ascending: true }),
        ctx.supabase
          .from("projects")
          .select("id")
          .eq("organizationId", input.id),
        ctx.supabase
          .from("organization_invites")
          .select("id", { count: "exact", head: true })
          .eq("organizationId", input.id)
          .eq("status", "PENDING"),
        ctx.supabase
          .from("profiles")
          .select("id, email, name, role")
          .eq("id", org.ownerId)
          .maybeSingle(),
        ctx.supabase
          .from("platform_audit_logs")
          .select("id, actorId, action, meta, createdAt")
          .eq("targetType", "organization")
          .eq("targetId", input.id)
          .order("createdAt", { ascending: false })
          .limit(20),
      ]);

      const projectIds = (projectRows ?? []).map((p) => p.id as string);
      let interviewCount = 0;
      if (projectIds.length > 0) {
        const { count } = await ctx.supabase
          .from("interviews")
          .select("id", { count: "exact", head: true })
          .in("projectId", projectIds);
        interviewCount = count ?? 0;
      }

      const members = memberRows ?? [];
      const userIds = Array.from(new Set(members.map((m) => m.userId as string)));
      const profileMap: Record<
        string,
        { email: string; name: string | null; role: string }
      > = {};
      if (userIds.length > 0) {
        const { data: profiles } = await ctx.supabase
          .from("profiles")
          .select("id, email, name, role")
          .in("id", userIds);
        for (const p of profiles ?? []) {
          profileMap[p.id as string] = {
            email: p.email as string,
            name: (p.name as string | null) ?? null,
            role: p.role as string,
          };
        }
      }

      const actorIds = Array.from(
        new Set((auditRows ?? []).map((r) => r.actorId as string)),
      );
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

      const status = (org.status as OrgStatus) ?? "ACTIVE";
      const plan = (org.plan as OrgPlan) ?? "SELF_HOSTED";
      const limits = (org.limits as Record<string, unknown>) ?? {};
      const platform = await loadPlatformSettings(ctx.supabase);

      return {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        status,
        statusLabel: STATUS_LABEL[status],
        plan,
        planLabel: planLabel(plan, platform.planCatalog),
        limits: {
          seats: typeof limits.seats === "number" ? limits.seats : null,
          interviews:
            typeof limits.interviews === "number" ? limits.interviews : null,
          projects:
            typeof limits.projects === "number" ? limits.projects : null,
        },
        featureFlags: (org.featureFlags as Record<string, unknown>) ?? {},
        billing: {
          email: (org.billingEmail as string | null) ?? null,
          stripeCustomerId: (org.stripeCustomerId as string | null) ?? null,
          stripeSubscriptionId:
            (org.stripeSubscriptionId as string | null) ?? null,
        },
        memberCount: members.length,
        projectCount: projectIds.length,
        interviewCount,
        pendingInviteCount: pendingInviteCount ?? 0,
        owner: owner
          ? {
              id: owner.id as string,
              email: owner.email as string,
              name: (owner.name as string | null) ?? null,
              platformRole: owner.role as string,
            }
          : null,
        members: members.map((m) => {
          const profile = profileMap[m.userId as string];
          const role = m.role as string;
          return {
            id: m.id as string,
            userId: m.userId as string,
            role,
            roleLabel: MEMBER_ROLE_LABEL[role] ?? role,
            email: profile?.email ?? "Unknown",
            name: profile?.name ?? null,
            platformRole: profile?.role ?? "USER",
            createdAt: m.joinedAt as string,
          };
        }),
        recentAudit: (auditRows ?? []).map((r) => ({
          id: r.id as string,
          action: r.action as string,
          meta: (r.meta as Record<string, unknown>) ?? {},
          actorName: actorMap[r.actorId as string] ?? "Someone",
          createdAt: r.createdAt as string,
        })),
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
        plan: orgPlanId,
        /** When true (default), copy the plan's feature flags onto the org. */
        applyFeatures: z.boolean().optional().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await loadPlatformSettings(ctx.supabase);
      const entry = settings.planCatalog.find((p) => p.id === input.plan);
      if (!entry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown plan "${input.plan}". Add it in Config → Plans first.`,
        });
      }

      const patch: Record<string, unknown> = { plan: entry.id };
      if (input.applyFeatures) {
        patch.featureFlags = entry.features;
      }

      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update(patch)
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
        planLabel: planLabel(plan, settings.planCatalog),
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
        .not("email", "like", "%@deleted.invalid")
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
      const paused = await pausedMap(ids);
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
          paused: Boolean(paused[p.id as string]),
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
          actionPrefix: z.string().max(40).optional(),
          targetType: z.enum(["organization", "user", "member"]).optional(),
          targetId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 30;
      let req = ctx.supabase
        .from("platform_audit_logs")
        .select("id, actorId, action, targetType, targetId, meta, createdAt")
        .order("createdAt", { ascending: false })
        .limit(limit);

      if (input?.targetType) req = req.eq("targetType", input.targetType);
      if (input?.targetId) req = req.eq("targetId", input.targetId);
      if (input?.actionPrefix?.trim()) {
        req = req.like("action", `${input.actionPrefix.trim()}%`);
      }

      const { data } = await req;

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

  setOrganizationLimits: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        seats: limitValue,
        interviews: limitValue,
        projects: limitValue,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const limits = {
        seats: input.seats,
        interviews: input.interviews,
        projects: input.projects,
      };
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({ limits })
        .eq("id", input.id)
        .neq("status", "DELETED")
        .select("id, name, limits")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.set_limits",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, limits },
      });

      return { id: org.id as string, limits };
    }),

  softDeleteOrganization: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Must match current org name — typed confirm from the UI. */
        confirmName: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("organizations")
        .select("id, name, slug, status")
        .eq("id", input.id)
        .maybeSingle();

      if (!existing || existing.status === "DELETED") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }
      if (existing.name !== input.confirmName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Name does not match. Removal cancelled.",
        });
      }

      const previousName = existing.name as string;
      const previousSlug = existing.slug as string;
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({
          status: "DELETED",
          name: "Deleted organization",
          slug: `deleted-${input.id.slice(0, 8)}-${nanoid(4)}`,
        })
        .eq("id", input.id)
        .neq("status", "DELETED")
        .select("id")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await ctx.supabase
        .from("organization_invites")
        .update({ status: "REVOKED" })
        .eq("organizationId", input.id)
        .eq("status", "PENDING");

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.delete",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: previousName, slug: previousSlug },
      });

      return { id: org.id as string, status: "DELETED" as const };
    }),

  restoreOrganization: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(3)
          .max(50)
          .regex(/^[a-z0-9-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({
          status: "ACTIVE",
          name: input.name,
          slug: input.slug,
        })
        .eq("id", input.id)
        .eq("status", "DELETED")
        .select("id, name, slug, status")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Removed organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.restore",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, slug: org.slug },
      });

      return {
        id: org.id as string,
        status: "ACTIVE" as const,
        statusLabel: STATUS_LABEL.ACTIVE,
        name: org.name as string,
        slug: org.slug as string,
      };
    }),

  setMemberRole: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
        role: memberRoleEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transfer ownership from the organization settings instead.",
        });
      }

      const { data: membership } = await ctx.supabase
        .from("organization_members")
        .select("id, role")
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId)
        .maybeSingle();

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }
      if (membership.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change the owner's role here.",
        });
      }

      const { data: updated, error } = await ctx.supabase
        .from("organization_members")
        .update({ role: input.role })
        .eq("id", membership.id)
        .select("id, role, userId")
        .maybeSingle();

      if (error || !updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not update member role.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.member.set_role",
        targetType: "member",
        targetId: updated.id as string,
        meta: {
          organizationId: input.organizationId,
          userId: input.userId,
          role: updated.role,
        },
      });

      const role = updated.role as string;
      return {
        id: updated.id as string,
        role,
        roleLabel: MEMBER_ROLE_LABEL[role] ?? role,
      };
    }),

  removeMember: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: membership } = await ctx.supabase
        .from("organization_members")
        .select("id, role")
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId)
        .maybeSingle();

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }
      if (membership.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the organization owner.",
        });
      }

      const { error } = await ctx.supabase
        .from("organization_members")
        .delete()
        .eq("id", membership.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not remove member.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.member.remove",
        targetType: "member",
        targetId: membership.id as string,
        meta: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      });

      return { success: true };
    }),

  getPerson: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: person } = await ctx.supabase
        .from("profiles")
        .select("id, email, name, role, createdAt")
        .eq("id", input.id)
        .maybeSingle();

      if (!person) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Person not found.",
        });
      }

      const { data: memberships } = await ctx.supabase
        .from("organization_members")
        .select("id, role, organizationId, joinedAt")
        .eq("userId", input.id);

      const orgIds = Array.from(
        new Set((memberships ?? []).map((m) => m.organizationId as string)),
      );
      const orgMap: Record<
        string,
        { name: string; slug: string; status: string }
      > = {};
      if (orgIds.length > 0) {
        const { data: orgs } = await ctx.supabase
          .from("organizations")
          .select("id, name, slug, status")
          .in("id", orgIds);
        for (const o of orgs ?? []) {
          orgMap[o.id as string] = {
            name: o.name as string,
            slug: o.slug as string,
            status: (o.status as string) ?? "ACTIVE",
          };
        }
      }

      const role = person.role as string;
      const pausedAt = (await pausedMap([input.id]))[input.id] ?? null;
      return {
        id: person.id as string,
        email: person.email as string,
        name: (person.name as string | null) ?? null,
        role,
        roleLabel: PLATFORM_ROLE_LABEL[role] ?? role,
        isPlatformAdmin: role === "ADMIN",
        paused: Boolean(pausedAt),
        pausedAt,
        createdAt: person.createdAt as string,
        memberships: (memberships ?? []).map((m) => {
          const org = orgMap[m.organizationId as string];
          const memberRole = m.role as string;
          return {
            id: m.id as string,
            organizationId: m.organizationId as string,
            organizationName: org?.name ?? "Unknown",
            organizationSlug: org?.slug ?? "",
            organizationStatus: org?.status ?? "ACTIVE",
            role: memberRole,
            roleLabel: MEMBER_ROLE_LABEL[memberRole] ?? memberRole,
            createdAt: m.joinedAt as string,
          };
        }),
      };
    }),

  /** Server load graphs (Grafana/Prometheus) plus live-interview count for capacity planning. */
  serverActivity: platformProcedure
    .input(z.object({ minutes: z.number().int().min(5).max(10080).default(60) }).optional())
    .query(async ({ ctx, input }) => {
      const metrics = await queryServerMetrics({ minutes: input?.minutes ?? 60 });
      // "Live" = interview began and the candidate tab is still beating.
      const cutoff = new Date(Date.now() - 20_000).toISOString();
      const { count } = await ctx.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "IN_PROGRESS")
        .not("interviewBeganAt", "is", null)
        .gte("lastHeartbeatAt", cutoff);
      return { ...metrics, liveInterviews: count ?? 0 };
    }),

  /** Pause (block login + live sessions) or resume an account. Reversible. */
  setPersonStatus: platformProcedure
    .input(z.object({ userId: z.string().uuid(), paused: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.paused && input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot pause your own account.",
        });
      }
      const { data: person } = await ctx.supabase
        .from("profiles")
        .select("id, email, name")
        .eq("id", input.userId)
        .maybeSingle();
      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
      }
      const { error } = await setUserPaused(input.userId, input.paused);
      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not update this account.",
        });
      }
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: input.paused ? "user.pause" : "user.resume",
        targetType: "user",
        targetId: input.userId,
        meta: { email: person.email, name: person.name },
      });
      return { id: input.userId, paused: input.paused };
    }),

  /** Delete an account: credentials + profile scrubbed, a snapshot is archived. */
  deletePerson: platformProcedure
    .input(z.object({ userId: z.string().uuid(), confirmEmail: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use your account page to delete your own account.",
        });
      }
      const { data: person } = await ctx.supabase
        .from("profiles")
        .select("id, email, name")
        .eq("id", input.userId)
        .maybeSingle();
      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found." });
      }
      if (String(person.email).toLowerCase() !== input.confirmEmail.trim().toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email does not match. Deletion cancelled.",
        });
      }
      const result = await deleteAccount(input.userId, { deletedBy: ctx.user.id });
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      }
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "user.delete",
        targetType: "user",
        targetId: input.userId,
        meta: { email: person.email, name: person.name },
      });
      return { id: input.userId };
    }),

  setPlatformRole: platformProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: platformRoleEnum,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && input.role !== "ADMIN") {
        const { count } = await ctx.supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "ADMIN");
        if ((count ?? 0) <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You are the last platform admin. Promote someone else first.",
          });
        }
      }

      const { data: person, error } = await ctx.supabase
        .from("profiles")
        .update({ role: input.role })
        .eq("id", input.userId)
        .select("id, email, name, role")
        .maybeSingle();

      if (error || !person) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Person not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "user.set_platform_role",
        targetType: "user",
        targetId: person.id as string,
        meta: {
          email: person.email,
          name: person.name,
          role: person.role,
        },
      });

      const role = person.role as string;
      return {
        id: person.id as string,
        role,
        roleLabel: PLATFORM_ROLE_LABEL[role] ?? role,
        isPlatformAdmin: role === "ADMIN",
      };
    }),

  /** Linux node logs from Grafana Cloud Loki (instance=skillmark). */
  serverLogs: platformProcedure
    .input(
      z.object({
        source: z
          .enum(["all", "syslog", "auth", "kern", "ufw", "dpkg"])
          .default("all"),
        search: z.string().max(200).optional(),
        minutes: z.number().int().min(5).max(10_080).default(60),
        limit: z.number().int().min(1).max(500).default(120),
      }),
    )
    .query(async ({ input }) => {
      const result = await queryGrafanaLinuxLogs({
        source: input.source as GrafanaLogSource,
        search: input.search,
        minutes: input.minutes,
        limit: input.limit,
      });
      return {
        ...result,
        sources: GRAFANA_LOG_SOURCES,
        instance: process.env.GRAFANA_LOG_INSTANCE || "skillmark",
      };
    }),

  /** UptimeRobot monitors (all, including /admin probes). */
  statusMonitors: platformProcedure.query(async () => {
    return getUptimeStatus();
  }),

  /** Create HTTP(s) checkbot monitor + optional public visibility. */
  createStatusMonitor: platformProcedure
    .input(
      z.object({
        url: z.string().url().max(2000),
        friendlyName: z.string().trim().min(1).max(120).optional(),
        intervalSeconds: z.number().int().min(60).max(3600).default(300),
        isPublic: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await createUptimeMonitor({
        url: input.url,
        friendlyName: input.friendlyName,
        intervalSeconds: input.intervalSeconds,
      });
      if (!created.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: created.error,
        });
      }

      const status = await getUptimeStatus();
      const heuristicPublicIds = status.monitors
        .filter((m) => m.audience === "public")
        .map((m) => m.id);
      let vis = await seedUptimeVisibilityIfNeeded(
        heuristicPublicIds,
        ctx.user.id,
      );
      const ids = new Set(vis.publicIds);
      if (input.isPublic) ids.add(created.id);
      else ids.delete(created.id);
      vis = await saveUptimeVisibility(
        { publicIds: [...ids], seeded: true },
        ctx.user.id,
      );
      invalidateUptimeCache();

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "uptime.monitor.create",
        targetType: "uptime_monitor",
        targetId: String(created.id),
        meta: {
          url: created.url,
          name: created.name,
          isPublic: input.isPublic,
        },
      });

      return {
        ...created,
        isPublic: vis.publicIds.includes(created.id),
        status: await getUptimeStatus(),
      };
    }),

  /** Toggle whether a monitor appears on landing + user /status. */
  setStatusMonitorPublic: platformProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        isPublic: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const status = await getUptimeStatus();
      const monitor = status.monitors.find((m) => m.id === input.id);
      if (!monitor) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Monitor not found",
        });
      }

      const heuristicPublicIds = status.monitors
        .filter((m) => m.audience === "public")
        .map((m) => m.id);
      let vis = await seedUptimeVisibilityIfNeeded(
        heuristicPublicIds,
        ctx.user.id,
      );
      const ids = new Set(vis.publicIds);
      if (input.isPublic) ids.add(input.id);
      else ids.delete(input.id);
      vis = await saveUptimeVisibility(
        { publicIds: [...ids], seeded: true },
        ctx.user.id,
      );
      invalidateUptimeCache();

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "uptime.monitor.visibility",
        targetType: "uptime_monitor",
        targetId: String(input.id),
        meta: {
          url: monitor.url,
          name: monitor.name,
          isPublic: input.isPublic,
        },
      });

      return {
        id: input.id,
        isPublic: vis.publicIds.includes(input.id),
        status: await getUptimeStatus(),
      };
    }),

  /** Read current public-visibility allowlist (debug / settings). */
  statusVisibility: platformProcedure.query(async () => {
    return loadUptimeVisibility();
  }),

  getSettings: platformProcedure.query(async ({ ctx }) => {
    return loadPlatformSettings(ctx.supabase);
  }),

  updateInstanceSettings: platformProcedure
    .input(
      z.object({
        maxOrgsPerAccount: z.number().int().min(1).max(100),
        allowOrgSelfDelete: z.boolean(),
        allowOrgSelfServeBilling: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const value = parseInstanceSettings(input);
      await upsertPlatformSetting(
        ctx.supabase,
        "instance",
        value,
        ctx.user.id,
      );
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "config.instance",
        targetType: "organization",
        targetId: null,
        meta: value as unknown as Record<string, unknown>,
      });
      return value;
    }),

  /** Replace the editable plan catalog (limits + features + Stripe). */
  updatePlanCatalog: platformProcedure
    .input(z.object({ plans: z.array(planCatalogEntrySchema).min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const catalog = parsePlanCatalog(input.plans);
      if (catalog.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one valid plan is required.",
        });
      }
      for (const id of PROTECTED_PLAN_IDS) {
        if (!catalog.some((p) => p.id === id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Protected plan ${id} cannot be removed.`,
          });
        }
      }
      const ids = catalog.map((p) => p.id);
      if (new Set(ids).size !== ids.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Plan ids must be unique.",
        });
      }

      const planLimits = limitsFromCatalog(catalog);
      await upsertPlatformSetting(
        ctx.supabase,
        "planCatalog",
        catalog,
        ctx.user.id,
      );
      await upsertPlatformSetting(
        ctx.supabase,
        "planLimits",
        planLimits,
        ctx.user.id,
      );
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "config.plan_catalog",
        targetType: "organization",
        targetId: null,
        meta: { plans: ids },
      });
      return catalog;
    }),

  updateDefaultFeatureFlags: platformProcedure
    .input(
      z.object({
        aiSettings: z.boolean(),
        integrations: z.boolean(),
        voiceInterviews: z.boolean(),
        publicForms: z.boolean(),
        usageDashboard: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const value = parseDefaultFeatureFlags(input);
      await upsertPlatformSetting(
        ctx.supabase,
        "defaultFeatureFlags",
        value,
        ctx.user.id,
      );
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "config.feature_flags",
        targetType: "organization",
        targetId: null,
        meta: value as unknown as Record<string, unknown>,
      });
      return value;
    }),

  updateOrganization: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        slug: z
          .string()
          .min(3)
          .max(50)
          .regex(/^[a-z0-9-]+$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.slug !== undefined) patch.slug = input.slug;
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nothing to update.",
        });
      }

      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update(patch)
        .eq("id", input.id)
        .select("id, name, slug")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.update",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, slug: org.slug },
      });

      return {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
      };
    }),

  setFeatureFlags: platformProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        featureFlags: z.object({
          aiSettings: z.boolean(),
          integrations: z.boolean(),
          voiceInterviews: z.boolean(),
          publicForms: z.boolean(),
          usageDashboard: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const flags = parseDefaultFeatureFlags(input.featureFlags);
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update({ featureFlags: flags })
        .eq("id", input.id)
        .select("id, name, featureFlags")
        .maybeSingle();

      if (error || !org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "org.set_flags",
        targetType: "organization",
        targetId: org.id as string,
        meta: { name: org.name, featureFlags: flags },
      });

      return { id: org.id as string, featureFlags: flags };
    }),

  /** Organizations and their projects, for choosing which stored files to delete. */
  storageIndex: platformProcedure.query(async ({ ctx }) => {
    const [{ data: orgs }, { data: projects }] = await Promise.all([
      ctx.supabase
        .from("organizations")
        .select("id, name, status")
        .neq("status", "DELETED")
        .order("name"),
      ctx.supabase.from("projects").select("id, name, organizationId").order("name"),
    ]);
    return {
      organizations: (orgs ?? []).map((o) => ({
        id: o.id as string,
        name: o.name as string,
        status: (o.status as string) ?? "ACTIVE",
      })),
      projects: (projects ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        organizationId: p.organizationId as string,
      })),
    };
  }),

  /** Delete Backblaze/local files for every organization, chosen organizations, or chosen projects. */
  deleteStoredFiles: platformProcedure
    .input(
      z.object({
        scope: z.enum(["all", "organizations", "projects"]),
        organizationIds: z.array(z.string().uuid()).max(200).optional(),
        projectIds: z.array(z.string().uuid()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let organizationIds = input.organizationIds ?? [];
      if (input.scope === "all") {
        const { data } = await ctx.supabase.from("organizations").select("id");
        organizationIds = (data ?? []).map((o) => o.id as string);
      }
      if (input.scope === "organizations" && organizationIds.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one organization." });
      }
      if (input.scope === "projects" && (input.projectIds?.length ?? 0) === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one project." });
      }

      const result = await clearStoredMedia(ctx.supabase, {
        organizationIds,
        projectIds: input.scope === "projects" ? input.projectIds : undefined,
      });

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "storage.delete",
        targetType: "storage",
        targetId: ctx.user.id,
        meta: {
          scope: input.scope,
          organizations: organizationIds.length,
          projects: input.projectIds?.length ?? 0,
          objects: result.objects,
          sessions: result.sessions,
        },
      });

      return result;
    }),

  /** Storage telemetry and Backblaze B2 connection status */
  storageStats: platformProcedure.query(async ({ ctx }) => {
    const config = getStorageConfigSummary();

    const [{ count: sessionCount }, { count: candidateCount }] = await Promise.all([
      ctx.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .not("audioRecordingUrl", "is", null),
      ctx.supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .not("profile", "is", null),
    ]);

    return {
      config,
      totalRecordingsTracked: sessionCount ?? 0,
      totalCandidatesTracked: candidateCount ?? 0,
    };
  }),

  /** Generate signed URL on demand for any stored asset key */
  getSignedFileUrl: platformProcedure
    .input(
      z.object({
        key: z.string().min(1),
        bucket: z.string().default("files"),
        expiresIn: z.number().int().min(60).max(86400).default(7200),
      }),
    )
    .query(async ({ input }) => {
      const cleanKey = input.key.replace(/^\/+/, "");
      if (cleanKey.startsWith("http://") || cleanKey.startsWith("https://")) {
        return { signedUrl: cleanKey };
      }
      const { data, error } = await storage
        .from(input.bucket)
        .createSignedUrl(cleanKey, input.expiresIn);
      if (error || !data?.signedUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error?.message || "Could not generate signed URL for asset",
        });
      }
      return { signedUrl: data.signedUrl };
    }),

  /** Browse and inspect stored files across all organizations, projects, and candidates */
  storedFiles: platformProcedure
    .input(
      z.object({
        category: z
          .enum(["all", "recordings", "screenshots", "resumes", "raw"])
          .default("all"),
        organizationId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        search: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(200).default(60),
      }),
    )
    .query(async ({ ctx, input }) => {
      const config = getStorageConfigSummary();

      // Fetch orgs and projects map
      const [{ data: orgs }, { data: projects }] = await Promise.all([
        ctx.supabase.from("organizations").select("id, name"),
        ctx.supabase.from("projects").select("id, name, organizationId"),
      ]);

      const orgMap = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
      const projMap = new Map(
        (projects ?? []).map((p) => [
          p.id as string,
          {
            name: p.name as string,
            organizationId: p.organizationId as string,
            orgName: orgMap.get(p.organizationId as string) || "Unknown Org",
          },
        ]),
      );

      // Determine project filter
      let targetProjectIds: string[] | undefined;
      if (input.projectId) {
        targetProjectIds = [input.projectId];
      } else if (input.organizationId) {
        targetProjectIds = (projects ?? [])
          .filter((p) => p.organizationId === input.organizationId)
          .map((p) => p.id as string);
      }

      // Fetch interview ids matching projects if filtered
      const interviewMap = new Map<string, { id: string; title: string; projectId: string }>();
      let interviewQuery = ctx.supabase.from("interviews").select("id, title, projectId");
      if (targetProjectIds && targetProjectIds.length > 0) {
        interviewQuery = interviewQuery.in("projectId", targetProjectIds);
      }
      const { data: interviewRows } = await interviewQuery;
      for (const inv of interviewRows ?? []) {
        interviewMap.set(inv.id as string, {
          id: inv.id as string,
          title: (inv.title as string) || "AI Interview",
          projectId: inv.projectId as string,
        });
      }

      const matchingInterviewIds = targetProjectIds
        ? Array.from(interviewMap.keys())
        : undefined;

      const hasInterviews =
        !targetProjectIds || (matchingInterviewIds && matchingInterviewIds.length > 0);

      type StoredFileItem = {
        id: string;
        key: string;
        name: string;
        category: "recording" | "screenshot" | "resume" | "raw";
        contentType?: string;
        size?: number;
        createdAt?: string;
        signedUrl: string;
        candidateName?: string;
        candidateEmail?: string;
        candidateId?: string;
        sessionId?: string;
        interviewTitle?: string;
        interviewId?: string;
        projectName?: string;
        projectId?: string;
        organizationName?: string;
        organizationId?: string;
        timestamp?: number;
      };

      const collected: StoredFileItem[] = [];

      // 1. Collect Sessions (Recordings & Screenshots)
      if (
        hasInterviews &&
        (input.category === "all" ||
          input.category === "recordings" ||
          input.category === "screenshots")
      ) {
        let sessionQuery = ctx.supabase
          .from("sessions")
          .select(
            "id, interviewId, participantName, participantEmail, audioRecordingUrl, audioRecordings, screenshots, mediaStoragePrefix, createdAt",
          )
          .order("createdAt", { ascending: false })
          .limit(100);

        if (matchingInterviewIds && matchingInterviewIds.length > 0) {
          sessionQuery = sessionQuery.in("interviewId", matchingInterviewIds);
        }

        const { data: sessions } = await sessionQuery;

        for (const s of sessions ?? []) {
          const inv = interviewMap.get(s.interviewId as string);
          const proj = inv?.projectId ? projMap.get(inv.projectId) : undefined;
          const orgName = proj ? proj.orgName : undefined;
          const orgId = proj ? proj.organizationId : undefined;

          // Recording: audioRecordingUrl
          if (
            (input.category === "all" || input.category === "recordings") &&
            s.audioRecordingUrl &&
            typeof s.audioRecordingUrl === "string"
          ) {
            const rawKey = s.audioRecordingUrl.replace(/^\/+/, "");
            const parts = rawKey.split("/");
            const fileName = parts[parts.length - 1] || "recording.m4a";
            collected.push({
              id: `rec-${s.id}-main`,
              key: rawKey,
              name: fileName,
              category: "recording",
              contentType: fileName.endsWith(".webm")
                ? "audio/webm"
                : fileName.endsWith(".mp4")
                  ? "video/mp4"
                  : "audio/m4a",
              createdAt: s.createdAt as string,
              signedUrl: "",
              candidateName: (s.participantName as string) || "Candidate",
              candidateEmail: (s.participantEmail as string) || undefined,
              sessionId: s.id as string,
              interviewTitle: inv?.title || "AI Interview",
              interviewId: s.interviewId as string,
              projectName: proj?.name || "Project",
              projectId: inv?.projectId,
              organizationName: orgName,
              organizationId: orgId,
            });
          }

          // Recordings: audioRecordings array
          if (
            (input.category === "all" || input.category === "recordings") &&
            Array.isArray(s.audioRecordings)
          ) {
            (s.audioRecordings as Array<Record<string, unknown> | string>).forEach(
              (rec, idx) => {
                const recPath = typeof rec === "string" ? rec : (rec?.path as string);
                if (
                  recPath &&
                  typeof recPath === "string" &&
                  recPath !== s.audioRecordingUrl
                ) {
                  const rawKey = recPath.replace(/^\/+/, "");
                  const parts = rawKey.split("/");
                  const fileName =
                    parts[parts.length - 1] || `recording-part-${idx + 1}.webm`;
                  collected.push({
                    id: `rec-${s.id}-${idx}`,
                    key: rawKey,
                    name: fileName,
                    category: "recording",
                    contentType: fileName.endsWith(".webm") ? "audio/webm" : "audio/m4a",
                    createdAt: s.createdAt as string,
                    signedUrl: "",
                    candidateName: (s.participantName as string) || "Candidate",
                    candidateEmail: (s.participantEmail as string) || undefined,
                    sessionId: s.id as string,
                    interviewTitle: inv?.title || "AI Interview",
                    interviewId: s.interviewId as string,
                    projectName: proj?.name || "Project",
                    projectId: inv?.projectId,
                    organizationName: orgName,
                    organizationId: orgId,
                  });
                }
              },
            );
          }

          // Screenshots
          if (
            (input.category === "all" || input.category === "screenshots") &&
            Array.isArray(s.screenshots)
          ) {
            (s.screenshots as Array<Record<string, unknown> | string>).forEach(
              (shot, idx) => {
                const shotPath =
                  typeof shot === "string" ? shot : (shot?.path as string);
                if (shotPath && typeof shotPath === "string") {
                  const rawKey = shotPath.replace(/^\/+/, "");
                  const parts = rawKey.split("/");
                  const fileName = parts[parts.length - 1] || `proctor-${idx + 1}.jpg`;
                  collected.push({
                    id: `shot-${s.id}-${idx}`,
                    key: rawKey,
                    name: fileName,
                    category: "screenshot",
                    contentType: "image/jpeg",
                    createdAt: s.createdAt as string,
                    signedUrl: "",
                    candidateName: (s.participantName as string) || "Candidate",
                    candidateEmail: (s.participantEmail as string) || undefined,
                    sessionId: s.id as string,
                    interviewTitle: inv?.title || "AI Interview",
                    interviewId: s.interviewId as string,
                    projectName: proj?.name || "Project",
                    projectId: inv?.projectId,
                    organizationName: orgName,
                    organizationId: orgId,
                    timestamp:
                      typeof shot === "object" && typeof shot?.timestamp === "number"
                        ? shot.timestamp
                        : undefined,
                  });
                }
              },
            );
          }
        }
      }

      // 2. Collect Candidates (Resumes & CVs)
      if (hasInterviews && (input.category === "all" || input.category === "resumes")) {
        let candQuery = ctx.supabase
          .from("candidates")
          .select("id, name, email, interviewId, sessionId, profile, createdAt")
          .not("profile", "is", null)
          .order("createdAt", { ascending: false })
          .limit(100);

        if (matchingInterviewIds && matchingInterviewIds.length > 0) {
          candQuery = candQuery.in("interviewId", matchingInterviewIds);
        }

        const { data: candidates } = await candQuery;

        for (const c of candidates ?? []) {
          const profile = c.profile as Record<string, unknown> | null;
          if (profile && typeof profile === "object" && profile.cvPath) {
            const rawKey = String(profile.cvPath).replace(/^\/+/, "");
            const fileName =
              (profile.fileName as string) || rawKey.split("/").pop() || "resume.pdf";
            const inv = interviewMap.get(c.interviewId as string);
            const proj = inv?.projectId ? projMap.get(inv.projectId) : undefined;
            collected.push({
              id: `cv-${c.id}`,
              key: rawKey,
              name: fileName,
              category: "resume",
              contentType: (profile.cvType as string) || "application/pdf",
              size: typeof profile.cvSize === "number" ? profile.cvSize : undefined,
              createdAt: c.createdAt as string,
              signedUrl: "",
              candidateName: (c.name as string) || "Candidate",
              candidateEmail: (c.email as string) || undefined,
              candidateId: c.id as string,
              sessionId: (c.sessionId as string) || undefined,
              interviewTitle: inv?.title || "AI Interview",
              interviewId: c.interviewId as string,
              projectName: proj?.name || "Project",
              projectId: inv?.projectId,
              organizationName: proj?.orgName,
              organizationId: proj?.organizationId,
            });
          }
        }
      }

      // 3. Raw B2/S3 Direct Bucket Objects (if category === "raw" or "all")
      if (input.category === "raw" || input.category === "all") {
        try {
          const rawPrefix = input.organizationId
            ? `orgs/${input.organizationId}`
            : "orgs/";
          const rawObjects = await listObjectsWithMetadata(rawPrefix, 100);
          const existingKeys = new Set(collected.map((c) => c.key));

          for (const obj of rawObjects) {
            if (!existingKeys.has(obj.key)) {
              const parts = obj.key.split("/");
              const fileName = parts[parts.length - 1] || obj.key;
              let cat: "recording" | "screenshot" | "resume" | "raw" = "raw";
              if (/\.(m4a|webm|mp3|wav|mp4)$/i.test(fileName)) cat = "recording";
              else if (/\.(jpg|jpeg|png|webp)$/i.test(fileName)) cat = "screenshot";
              else if (/\.(pdf|docx?)$/i.test(fileName)) cat = "resume";

              let matchedOrgId: string | undefined;
              let matchedProjId: string | undefined;
              if (parts[0] === "orgs" && parts.length >= 4) {
                matchedOrgId = parts[1];
                if (parts[2] === "projects") matchedProjId = parts[3];
              }

              const proj = matchedProjId ? projMap.get(matchedProjId) : undefined;
              const orgName =
                (matchedOrgId ? orgMap.get(matchedOrgId) : undefined) || proj?.orgName;

              if (input.organizationId && matchedOrgId && matchedOrgId !== input.organizationId)
                continue;
              if (input.projectId && matchedProjId && matchedProjId !== input.projectId)
                continue;

              if (input.category === "all" || input.category === cat || input.category === "raw") {
                collected.push({
                  id: `raw-${obj.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
                  key: obj.key,
                  name: fileName,
                  category: cat,
                  size: obj.size,
                  createdAt: obj.lastModified,
                  signedUrl: "",
                  projectName: proj?.name,
                  projectId: matchedProjId,
                  organizationName: orgName,
                  organizationId: matchedOrgId,
                });
              }
            }
          }
        } catch {
          // Continue gracefully
        }
      }

      // 4. Apply text search filter if provided
      let filtered = collected;
      if (input.search && input.search.trim()) {
        const query = input.search.toLowerCase();
        filtered = filtered.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.key.toLowerCase().includes(query) ||
            item.candidateName?.toLowerCase().includes(query) ||
            item.candidateEmail?.toLowerCase().includes(query) ||
            item.projectName?.toLowerCase().includes(query) ||
            item.organizationName?.toLowerCase().includes(query),
        );
      }

      // 5. Slice to limit
      const itemsToSign = filtered.slice(0, input.limit);

      // 6. Generate signed URLs concurrently
      await Promise.all(
        itemsToSign.map(async (item) => {
          if (item.key.startsWith("http://") || item.key.startsWith("https://")) {
            item.signedUrl = item.key;
            return;
          }
          try {
            const { data } = await storage.from("files").createSignedUrl(item.key, 7200);
            item.signedUrl = data?.signedUrl || "";
          } catch {
            item.signedUrl = "";
          }
        }),
      );

      // Compute counts by category
      const counts = {
        all: collected.length,
        recordings: collected.filter((c) => c.category === "recording").length,
        screenshots: collected.filter((c) => c.category === "screenshot").length,
        resumes: collected.filter((c) => c.category === "resume").length,
        raw: collected.filter((c) => c.category === "raw").length,
      };

      // Group items into candidate-level folder directories:
      // candidateName/recordings, candidateName/images, candidateName/CV
      const candidateFolderMap = new Map<
        string,
        {
          candidateId: string;
          candidateName: string;
          candidateEmail?: string;
          organizationId?: string;
          organizationName?: string;
          projectId?: string;
          projectName?: string;
          folderSlug: string;
          folderPath: string;
          recordings: StoredFileItem[];
          images: StoredFileItem[];
          cv: StoredFileItem[];
          raw: StoredFileItem[];
          totalFiles: number;
          totalSizeBytes: number;
          latestActivity?: string;
        }
      >();

      for (const item of itemsToSign) {
        const candKey =
          item.candidateId ||
          item.candidateName ||
          item.sessionId ||
          (item.key.includes("/candidates/")
            ? item.key.split("/candidates/")[1]?.split("/")[0]
            : "unassigned");
        const candName = item.candidateName || "Unassigned Assets";

        if (!candidateFolderMap.has(candKey)) {
          const folderSlug = candidateFolderSlug({
            candidateId: item.candidateId || item.sessionId || "general",
            candidateName: item.candidateName,
          });
          const folderPath =
            item.organizationId && item.projectId
              ? `orgs/${item.organizationId}/projects/${item.projectId}/candidates/${folderSlug}`
              : `candidates/${folderSlug}`;

          candidateFolderMap.set(candKey, {
            candidateId: item.candidateId || item.sessionId || candKey,
            candidateName: candName,
            candidateEmail: item.candidateEmail,
            organizationId: item.organizationId,
            organizationName: item.organizationName,
            projectId: item.projectId,
            projectName: item.projectName,
            folderSlug,
            folderPath,
            recordings: [],
            images: [],
            cv: [],
            raw: [],
            totalFiles: 0,
            totalSizeBytes: 0,
            latestActivity: item.createdAt,
          });
        }

        const group = candidateFolderMap.get(candKey)!;
        group.totalFiles += 1;
        if (typeof item.size === "number") group.totalSizeBytes += item.size;
        if (
          item.createdAt &&
          (!group.latestActivity || item.createdAt > group.latestActivity)
        ) {
          group.latestActivity = item.createdAt;
        }

        if (item.category === "recording") {
          group.recordings.push(item);
        } else if (item.category === "screenshot") {
          group.images.push(item);
        } else if (item.category === "resume") {
          group.cv.push(item);
        } else {
          group.raw.push(item);
        }
      }

      const candidateFolders = Array.from(candidateFolderMap.values());

      return {
        items: itemsToSign,
        candidateFolders,
        total: filtered.length,
        counts,
        config,
      };
    }),

  /**
   * Reorganize Backblaze B2 & storage folders into clean layout:
   *   orgs/{org}/projects/{project}/candidates/{candidateName}_{shortId}/recordings/...
   *   orgs/{org}/projects/{project}/candidates/{candidateName}_{shortId}/images/...
   *   orgs/{org}/projects/{project}/candidates/{candidateName}_{shortId}/CV/...
   * and update corresponding database records.
   */
  reorganizeStoredFiles: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let migratedCount = 0;
      let sessionsUpdated = 0;
      let candidatesUpdated = 0;

      // 1. Fetch sessions with candidate and interview metadata
      const sessionQuery = ctx.supabase
        .from("sessions")
        .select(
          `id, audioRecordingUrl, screenshots, audioRecordings, mediaStoragePrefix, participantName,
           interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
        )
        .order("createdAt", { ascending: false })
        .limit(150);

      const { data: sessions } = await sessionQuery;

      for (const s of sessions ?? []) {
        const interview = s.interview as unknown as {
          id: string;
          projectId: string;
          project: { id: string; organizationId: string };
        };
        const orgId = interview?.project?.organizationId;
        const projectId = interview?.projectId;
        if (!orgId || !projectId) continue;

        if (input.organizationId && orgId !== input.organizationId) continue;
        if (input.projectId && projectId !== input.projectId) continue;

        // Fetch candidate
        const { data: candidate } = await ctx.supabase
          .from("candidates")
          .select("id, name")
          .eq("sessionId", s.id)
          .maybeSingle();

        const candidateName =
          (candidate?.name as string | undefined) ||
          (s.participantName as string | undefined) ||
          "Candidate";
        const subjectId = candidate?.id || `session-${s.id}`;
        const newPrefix = candidateMediaPrefix({
          orgId,
          projectId,
          candidateId: subjectId,
          candidateName,
        });

        let sessionDirty = false;
        let newAudioRecordingUrl = s.audioRecordingUrl as string | null;
        let newScreenshots = (s.screenshots as Array<Record<string, unknown> | string>) || [];

        // Check audioRecordingUrl
        if (
          typeof s.audioRecordingUrl === "string" &&
          s.audioRecordingUrl.startsWith("orgs/")
        ) {
          const currentKey = s.audioRecordingUrl.replace(/^\/+/, "");
          const fileName = currentKey.split("/").pop() || "recording.m4a";
          const desiredKey = mediaObjectKey({
            orgId,
            projectId,
            candidateId: subjectId,
            candidateName,
            kind: "recordings",
            fileName,
          });

          if (currentKey !== desiredKey) {
            const moved = await moveStoredObject(currentKey, desiredKey);
            if (moved) {
              newAudioRecordingUrl = desiredKey;
              sessionDirty = true;
              migratedCount++;
            }
          }
        }

        // Check screenshots
        if (Array.isArray(s.screenshots) && s.screenshots.length > 0) {
          let shotsModified = false;
          const updatedShots = await Promise.all(
            (s.screenshots as Array<Record<string, unknown> | string>).map(
              async (shot, idx) => {
                const shotPath =
                  typeof shot === "string" ? shot : (shot?.path as string | undefined);
                if (typeof shotPath === "string" && shotPath.startsWith("orgs/")) {
                  const currentKey = shotPath.replace(/^\/+/, "");
                  const fileName =
                    currentKey.split("/").pop() || `capture-${idx + 1}.jpg`;
                  const desiredKey = mediaObjectKey({
                    orgId,
                    projectId,
                    candidateId: subjectId,
                    candidateName,
                    kind: "images",
                    fileName,
                  });

                  if (currentKey !== desiredKey) {
                    const moved = await moveStoredObject(currentKey, desiredKey);
                    if (moved) {
                      shotsModified = true;
                      migratedCount++;
                      if (typeof shot === "object" && shot !== null) {
                        return { ...shot, path: desiredKey };
                      }
                      return desiredKey;
                    }
                  }
                }
                return shot;
              },
            ),
          );

          if (shotsModified) {
            newScreenshots = updatedShots;
            sessionDirty = true;
          }
        }

        if (sessionDirty || s.mediaStoragePrefix !== newPrefix) {
          await ctx.supabase
            .from("sessions")
            .update({
              audioRecordingUrl: newAudioRecordingUrl,
              screenshots: newScreenshots,
              mediaStoragePrefix: newPrefix,
            })
            .eq("id", s.id);
          sessionsUpdated++;
        }
      }

      // 2. Fetch candidates with resumes
      const candQuery = ctx.supabase
        .from("candidates")
        .select(
          `id, name, profile,
           interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
        )
        .not("profile", "is", null)
        .order("createdAt", { ascending: false })
        .limit(100);

      const { data: candidates } = await candQuery;

      for (const c of candidates ?? []) {
        const interview = c.interview as unknown as {
          id: string;
          projectId: string;
          project: { id: string; organizationId: string };
        };
        const orgId = interview?.project?.organizationId;
        const projectId = interview?.projectId;
        if (!orgId || !projectId) continue;

        if (input.organizationId && orgId !== input.organizationId) continue;
        if (input.projectId && projectId !== input.projectId) continue;

        const profile = c.profile as Record<string, unknown> | null;
        if (profile && typeof profile === "object" && profile.cvPath) {
          const currentCvPath = String(profile.cvPath).replace(/^\/+/, "");
          if (currentCvPath.startsWith("orgs/")) {
            const fileName =
              (profile.fileName as string | undefined) ||
              currentCvPath.split("/").pop() ||
              "resume.pdf";
            const desiredKey = mediaObjectKey({
              orgId,
              projectId,
              candidateId: c.id as string,
              candidateName: c.name as string,
              kind: "CV",
              fileName,
            });

            if (currentCvPath !== desiredKey) {
              const moved = await moveStoredObject(currentCvPath, desiredKey);
              if (moved) {
                await ctx.supabase
                  .from("candidates")
                  .update({
                    profile: {
                      ...profile,
                      cvPath: desiredKey,
                    },
                  })
                  .eq("id", c.id);
                candidatesUpdated++;
                migratedCount++;
              }
            }
          }
        }
      }

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "storage.reorganize_folders",
        targetType: "storage",
        targetId: ctx.user.id,
        meta: {
          migratedCount,
          sessionsUpdated,
          candidatesUpdated,
        },
      });

      return {
        migratedCount,
        sessionsUpdated,
        candidatesUpdated,
      };
    }),
});
