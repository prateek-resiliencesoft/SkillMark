import { nanoid } from "@/lib/id";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appBaseUrl } from "../batch-access";
import { deliverEmail, loadDeliveryConfig } from "../invite-delivery";
import { assertQuota } from "../quotas";
import { requireOrgAccess } from "../tenant";
import {
  assertMinRole,
  getOrgMembership,
  protectedProcedure,
  publicProcedure,
  router,
} from "../trpc";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Lazily populate project_members for all org members the first time
 * project-level membership is explicitly managed (role change or removal).
 */
async function ensureProjectMembersPopulated(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  projectId: string,
) {
  const { count } = await supabase
    .from("project_members")
    .select("id", { count: "exact", head: true })
    .eq("projectId", projectId);

  if ((count ?? 0) > 0) return;

  const { data: orgMembers } = await supabase
    .from("organization_members")
    .select("userId, role")
    .eq("organizationId", organizationId);

  if (!orgMembers || orgMembers.length === 0) return;

  await supabase.from("project_members").insert(
    orgMembers.map((m) => ({
      projectId,
      userId: m.userId,
      role: m.role,
    })),
  );
}

export const orgMemberRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const { data: members } = await ctx.supabase
        .from("organization_members")
        .select("id, userId, role, joinedAt")
        .eq("organizationId", input.organizationId)
        .order("joinedAt", { ascending: true });

      const rows = members ?? [];
      if (rows.length === 0) return [];

      const userIds = rows.map((m) => m.userId);
      const { data: profiles } = await ctx.supabase
        .from("profiles")
        .select("id, email, name, avatar")
        .in("id", userIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.id, p]),
      );

      return rows.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role as string,
        joinedAt: m.joinedAt,
        profile: (profileMap.get(m.userId) as {
          id: string;
          email: string;
          name: string | null;
          avatar: string | null;
        }) ?? null,
      }));
    }),

  /**
   * Create a pending invite. Works for people who do not have an account yet.
   * If email delivery is configured for the org, a message is sent; otherwise
   * the invite link is returned for the admin to share.
   */
  invite: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "ADMIN", requireActive: true },
      );

      if (input.role === "ADMIN") {
        const caller = await getOrgMembership(
          ctx.supabase,
          input.organizationId,
          ctx.user.id,
        );
        if (caller?.role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the owner can invite someone as Admin",
          });
        }
      }

      const email = normalizeEmail(input.email);

      const { data: existingProfile } = await ctx.supabase
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (existingProfile) {
        const already = await getOrgMembership(
          ctx.supabase,
          input.organizationId,
          existingProfile.id,
        );
        if (already) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That person is already in this organization",
          });
        }
      }

      const { data: pending } = await ctx.supabase
        .from("organization_invites")
        .select("id")
        .eq("organizationId", input.organizationId)
        .eq("status", "PENDING")
        .ilike("email", email)
        .maybeSingle();

      if (pending) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An invite is already waiting for that email",
        });
      }

      await assertQuota(ctx.supabase, input.organizationId, "seats", 1);

      const token = nanoid(24);
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

      const { data: invite, error } = await ctx.supabase
        .from("organization_invites")
        .insert({
          organizationId: input.organizationId,
          email,
          role: input.role,
          token,
          invitedBy: ctx.user.id,
          status: "PENDING",
          expiresAt,
        })
        .select("id, email, role, token, expiresAt, status, createdAt")
        .single();

      if (error || !invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create the invite",
        });
      }

      const inviteUrl = `${appBaseUrl()}/invite/${token}`;
      let emailStatus: "sent" | "skipped" | "failed" = "skipped";

      try {
        const { data: org } = await ctx.supabase
          .from("organizations")
          .select("name")
          .eq("id", input.organizationId)
          .maybeSingle();
        const cfg = await loadDeliveryConfig(ctx.supabase, input.organizationId);
        const result = await deliverEmail(
          {
            ...cfg,
            templates: {
              emailSubject: `You're invited to join {{organization}} on Resiliencesoft Interview AI`,
              emailBody:
                "Hi,\n\n{{organization}} invited you to collaborate on Resiliencesoft Interview AI.\n\nOpen this link to join: {{link}}\n\nThis invite expires in 14 days.",
              whatsappBody: "",
            },
          },
          email,
          {
            name: email.split("@")[0] || "there",
            interviewTitle: "",
            organization: (org?.name as string) || cfg.organizationName,
            link: inviteUrl,
            duration: "",
            batchName: "",
          },
          `org-invite-${invite.id}`,
        );
        emailStatus = result.status === "sent" ? "sent" : result.status === "failed" ? "failed" : "skipped";
      } catch {
        emailStatus = "failed";
      }

      return {
        id: invite.id as string,
        email: invite.email as string,
        role: invite.role as string,
        expiresAt: invite.expiresAt as string,
        status: invite.status as string,
        inviteUrl,
        emailStatus,
      };
    }),

  listInvites: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "ADMIN" },
      );

      const { data } = await ctx.supabase
        .from("organization_invites")
        .select("id, email, role, status, expiresAt, createdAt, token")
        .eq("organizationId", input.organizationId)
        .eq("status", "PENDING")
        .order("createdAt", { ascending: false });

      const now = Date.now();
      return (data ?? []).map((row) => {
        const expired = new Date(row.expiresAt as string).getTime() < now;
        return {
          id: row.id as string,
          email: row.email as string,
          role: row.role as string,
          status: expired ? "EXPIRED" : (row.status as string),
          expiresAt: row.expiresAt as string,
          createdAt: row.createdAt as string,
          inviteUrl: `${appBaseUrl()}/invite/${row.token as string}`,
        };
      });
    }),

  revokeInvite: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        inviteId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "ADMIN", requireActive: true },
      );

      const { data, error } = await ctx.supabase
        .from("organization_invites")
        .update({ status: "REVOKED" })
        .eq("id", input.inviteId)
        .eq("organizationId", input.organizationId)
        .eq("status", "PENDING")
        .select("id")
        .maybeSingle();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found",
        });
      }
      return { success: true };
    }),

  /** Public preview of an invite link (no auth). */
  getInvite: publicProcedure
    .input(z.object({ token: z.string().min(8).max(64) }))
    .query(async ({ ctx, input }) => {
      const { data: invite } = await ctx.supabase
        .from("organization_invites")
        .select(
          "id, email, role, status, expiresAt, organizationId, organization:organizations(id, name, slug, status)",
        )
        .eq("token", input.token)
        .maybeSingle();

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invite link is not valid",
        });
      }

      const orgRaw = invite.organization as unknown;
      const org = (
        Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
      ) as {
        id: string;
        name: string;
        slug: string;
        status: string;
      } | null;

      const expired =
        invite.status !== "PENDING" ||
        new Date(invite.expiresAt as string).getTime() < Date.now() ||
        org?.status === "DELETED";

      return {
        email: invite.email as string,
        role: invite.role as string,
        status: expired
          ? invite.status === "PENDING"
            ? "EXPIRED"
            : (invite.status as string)
          : "PENDING",
        expiresAt: invite.expiresAt as string,
        organization: org
          ? {
              id: org.id,
              name: org.name,
              slug: org.slug,
              paused: org.status === "SUSPENDED",
            }
          : null,
      };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const { data: invite } = await ctx.supabase
        .from("organization_invites")
        .select(
          "id, email, role, status, expiresAt, organizationId",
        )
        .eq("token", input.token)
        .maybeSingle();

      if (!invite || invite.status !== "PENDING") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invite is no longer available",
        });
      }

      if (new Date(invite.expiresAt as string).getTime() < Date.now()) {
        await ctx.supabase
          .from("organization_invites")
          .update({ status: "EXPIRED" })
          .eq("id", invite.id);
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This invite has expired. Ask your admin for a new one.",
        });
      }

      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("email")
        .eq("id", ctx.user.id)
        .maybeSingle();

      const userEmail = normalizeEmail(
        (profile?.email as string) || ctx.user.email || "",
      );
      if (!userEmail || userEmail !== normalizeEmail(invite.email as string)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Sign in as ${invite.email} to accept this invite`,
        });
      }

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("id, status")
        .eq("id", invite.organizationId)
        .maybeSingle();

      if (!org || org.status === "DELETED") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This organization is no longer available",
        });
      }
      if (org.status === "SUSPENDED") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "This organization is paused. Ask the owner to resume it first.",
        });
      }

      const existing = await getOrgMembership(
        ctx.supabase,
        invite.organizationId as string,
        ctx.user.id,
      );
      if (!existing) {
        await assertQuota(
          ctx.supabase,
          invite.organizationId as string,
          "seats",
          1,
        );
        const { error: memberErr } = await ctx.supabase
          .from("organization_members")
          .insert({
            organizationId: invite.organizationId,
            userId: ctx.user.id,
            role: invite.role,
          });
        if (memberErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not join the organization",
          });
        }
      }

      await ctx.supabase
        .from("organization_invites")
        .update({
          status: "ACCEPTED",
          acceptedAt: new Date().toISOString(),
          acceptedBy: ctx.user.id,
        })
        .eq("id", invite.id);

      return {
        organizationId: invite.organizationId as string,
        role: invite.role as string,
      };
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!callerMembership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(callerMembership.role, "ADMIN");

      const targetMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        input.userId,
      );
      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (targetMembership.role === "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot change the role of the organization owner",
        });
      }

      // Admins cannot promote to ADMIN (only owners can)
      if (
        callerMembership.role === "ADMIN" &&
        input.role === "ADMIN" &&
        targetMembership.role !== "ADMIN"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can promote members to Admin",
        });
      }

      const { error } = await ctx.supabase
        .from("organization_members")
        .update({ role: input.role })
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      return { success: true };
    }),

  remove: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!callerMembership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(callerMembership.role, "ADMIN");

      const targetMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        input.userId,
      );
      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (targetMembership.role === "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove the organization owner",
        });
      }

      await ctx.supabase
        .from("organization_members")
        .delete()
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId);

      return { success: true };
    }),

  listProjectRoles: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const { data: projectMembers } = await ctx.supabase
        .from("project_members")
        .select("userId, role")
        .eq("projectId", input.projectId);

      const map: Record<string, string> = {};
      for (const pm of projectMembers ?? []) {
        map[pm.userId] = pm.role;
      }
      return map;
    }),

  updateProjectRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string(),
        userId: z.string(),
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!callerMembership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(callerMembership.role, "ADMIN");

      await ensureProjectMembersPopulated(
        ctx.supabase,
        input.organizationId,
        input.projectId,
      );

      const { error } = await ctx.supabase
        .from("project_members")
        .upsert(
          {
            projectId: input.projectId,
            userId: input.userId,
            role: input.role,
          },
          { onConflict: "projectId,userId" },
        );

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      return { success: true };
    }),

  addProjectMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!callerMembership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(callerMembership.role, "ADMIN");

      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("id")
        .eq("email", input.email)
        .single();

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No user found with that email. They must sign up first.",
        });
      }

      const orgMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        profile.id,
      );
      if (!orgMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "User is not a member of this organization. Invite them to the organization first.",
        });
      }

      await ensureProjectMembersPopulated(
        ctx.supabase,
        input.organizationId,
        input.projectId,
      );

      const { data: existing } = await ctx.supabase
        .from("project_members")
        .select("id")
        .eq("projectId", input.projectId)
        .eq("userId", profile.id)
        .single();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this project",
        });
      }

      const { error } = await ctx.supabase.from("project_members").insert({
        projectId: input.projectId,
        userId: profile.id,
        role: input.role,
      });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      return { success: true };
    }),

  removeProjectMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!callerMembership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(callerMembership.role, "ADMIN");

      await ensureProjectMembersPopulated(
        ctx.supabase,
        input.organizationId,
        input.projectId,
      );

      await ctx.supabase
        .from("project_members")
        .delete()
        .eq("projectId", input.projectId)
        .eq("userId", input.userId);

      return { success: true };
    }),

  leave: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (membership.role === "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Organization owner cannot leave. Transfer ownership or delete the organization.",
        });
      }

      await ctx.supabase
        .from("organization_members")
        .delete()
        .eq("organizationId", input.organizationId)
        .eq("userId", ctx.user.id);

      return { success: true };
    }),
});
