import { nanoid } from "@/lib/id";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertMinRole, getOrgMembership, protectedProcedure, router } from "../trpc";
import { requireOrgAccess } from "../tenant";

const MAX_ORGS_PER_ACCOUNT = 10;

export const organizationRouter = router({
  orgLimit: protectedProcedure.query(async () => {
    return { limit: MAX_ORGS_PER_ACCOUNT };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const { data: memberships } = await ctx.supabase
      .from("organization_members")
      .select(
        "role, organization:organizations(id, name, slug, ownerId, status, plan, createdAt, updatedAt)",
      )
      .eq("userId", ctx.user.id);

    return (memberships ?? [])
      .map((m) => {
        const raw = m.organization as unknown;
        const org = (
          Array.isArray(raw) ? raw[0] : raw
        ) as {
          id: string;
          name: string;
          slug: string;
          ownerId: string;
          status?: string;
          plan?: string;
          createdAt: string;
          updatedAt: string;
        } | null;
        if (!org || org.status === "DELETED") return null;
        return {
          ...org,
          status: org.status ?? "ACTIVE",
          plan: org.plan ?? "SELF_HOSTED",
          role: m.role as string,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.id,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("*")
        .eq("id", input.id)
        .single();

      if (!org || org.status === "DELETED") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { count: memberCount } = await ctx.supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .eq("organizationId", input.id);

      const { count: projectCount } = await ctx.supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("organizationId", input.id);

      return {
        ...org,
        role: membership.role,
        _count: {
          members: memberCount ?? 0,
          projects: projectCount ?? 0,
        },
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(3)
          .max(50)
          .regex(/^[a-z0-9-]+$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { count: ownedCount } = await ctx.supabase
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .eq("ownerId", ctx.user.id)
        .neq("status", "DELETED");

      if ((ownedCount ?? 0) >= MAX_ORGS_PER_ACCOUNT) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You have reached the maximum of ${MAX_ORGS_PER_ACCOUNT} organizations per account.`,
        });
      }

      const slug = input.slug ?? nanoid(8);

      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .insert({
          name: input.name,
          slug,
          ownerId: ctx.user.id,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      await ctx.supabase.from("organization_members").insert({
        organizationId: org.id,
        userId: ctx.user.id,
        role: "OWNER" as const,
      });

      await ctx.supabase.from("projects").insert({
        organizationId: org.id,
        name: "Default",
        createdBy: ctx.user.id,
      });

      return org;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(ctx.supabase, input.id, ctx.user.id, {
        minRole: "ADMIN",
        requireActive: true,
      });

      const { id, ...data } = input;
      const { data: org, error } = await ctx.supabase
        .from("organizations")
        .update(data)
        .eq("id", id)
        .neq("status", "DELETED")
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      return org;
    }),

  /**
   * Soft-delete: mark DELETED, revoke pending invites, keep rows for audit.
   * Hard cascade wipe is reserved for platform ops / retention jobs.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.id,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      assertMinRole(membership.role, "OWNER");

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
          message: "Organization not found",
        });
      }

      await ctx.supabase
        .from("organization_invites")
        .update({ status: "REVOKED" })
        .eq("organizationId", input.id)
        .eq("status", "PENDING");

      return { success: true };
    }),

  /**
   * Owner/admin download of org structure + membership (privacy export).
   * Interview answers/messages are summarized by count, not dumped wholesale —
   * full transcript export can be added per-interview later.
   */
  exportData: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "ADMIN" },
      );

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select(
          "id, name, slug, ownerId, status, plan, limits, featureFlags, createdAt, updatedAt",
        )
        .eq("id", input.organizationId)
        .maybeSingle();

      if (!org || org.status === "DELETED") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [{ data: members }, { data: invites }, { data: projects }] =
        await Promise.all([
          ctx.supabase
            .from("organization_members")
            .select("userId, role, joinedAt")
            .eq("organizationId", input.organizationId),
          ctx.supabase
            .from("organization_invites")
            .select("email, role, status, createdAt, expiresAt, acceptedAt")
            .eq("organizationId", input.organizationId),
          ctx.supabase
            .from("projects")
            .select("id, name, description, createdBy, createdAt, updatedAt")
            .eq("organizationId", input.organizationId),
        ]);

      const memberIds = (members ?? []).map((m) => m.userId as string);
      const profileMap: Record<
        string,
        { email: string; name: string | null }
      > = {};
      if (memberIds.length > 0) {
        const { data: profiles } = await ctx.supabase
          .from("profiles")
          .select("id, email, name")
          .in("id", memberIds);
        for (const p of profiles ?? []) {
          profileMap[p.id as string] = {
            email: p.email as string,
            name: (p.name as string | null) ?? null,
          };
        }
      }

      const projectIds = (projects ?? []).map((p) => p.id as string);
      let interviews: {
        id: string;
        title: string;
        projectId: string;
        createdAt: string;
        sessionCount: number;
      }[] = [];

      if (projectIds.length > 0) {
        const { data: ivs } = await ctx.supabase
          .from("interviews")
          .select("id, title, projectId, createdAt, sessions(id)")
          .in("projectId", projectIds)
          .order("createdAt", { ascending: false })
          .limit(500);

        interviews = (ivs ?? []).map((iv) => ({
          id: iv.id as string,
          title: iv.title as string,
          projectId: iv.projectId as string,
          createdAt: iv.createdAt as string,
          sessionCount: Array.isArray(iv.sessions) ? iv.sessions.length : 0,
        }));
      }

      return {
        exportedAt: new Date().toISOString(),
        organization: org,
        members: (members ?? []).map((m) => ({
          userId: m.userId as string,
          role: m.role as string,
          joinedAt: m.joinedAt as string,
          profile: profileMap[m.userId as string] ?? null,
        })),
        invites: invites ?? [],
        projects: projects ?? [],
        interviews,
      };
    }),
});
