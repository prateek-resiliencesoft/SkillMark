import { nanoid } from "@/lib/id";
import { findUserByEmail } from "@/lib/users";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { acceptOrgInviteForUser } from "../accept-org-invite";
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

type Supabase = Parameters<typeof getOrgMembership>[0];
type InviteRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
type OrgAssignableRole = InviteRole;

async function countOrgOwners(supabase: Supabase, organizationId: string) {
  const { count } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organizationId", organizationId)
    .eq("role", "OWNER");
  return count ?? 0;
}

/** Keep organizations.ownerId pointing at an OWNER after demote/remove. */
async function reassignOrgOwnerIdIfNeeded(
  supabase: Supabase,
  organizationId: string,
  departingUserId: string,
) {
  const { data: org } = await supabase
    .from("organizations")
    .select("ownerId")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org || org.ownerId !== departingUserId) return;

  const { data: next } = await supabase
    .from("organization_members")
    .select("userId")
    .eq("organizationId", organizationId)
    .eq("role", "OWNER")
    .neq("userId", departingUserId)
    .limit(1)
    .maybeSingle();

  if (next?.userId) {
    await supabase
      .from("organizations")
      .update({ ownerId: next.userId })
      .eq("id", organizationId);
  }
}

function inviteInsertError(error: { code?: string; message?: string } | null) {
  if (error?.code === "23505") {
    return new TRPCError({
      code: "CONFLICT",
      message: "An invite is already waiting for that email.",
    });
  }
  if (error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "42703" ||
    error?.code === "PGRST204") {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Invites are not set up on this server yet. Ask your administrator to run the database migrations (npm run db:migrate).",
    });
  }
  console.error("[orgMember] invite insert failed", error);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not create the invite because of a server error. Try again in a moment.",
  });
}

/**
 * Create a pending org invite (optionally granting one project on accept)
 * and email it when delivery is configured.
 */
async function createInvite(
  supabase: Supabase,
  invitedBy: string,
  input: {
    organizationId: string;
    email: string;
    role: InviteRole;
    project?: { id: string; name: string; role: InviteRole };
  },
) {
  const { organizationId, email, role, project } = input;

  const { data: pending, error: pendingErr } = await supabase
    .from("organization_invites")
    .select("id")
    .eq("organizationId", organizationId)
    .eq("status", "PENDING")
    .eq("email", email)
    .maybeSingle();

  if (pendingErr && !pending) throw inviteInsertError(pendingErr);
  if (pending) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `An invite for ${email} is already pending. Cancel it in Organization settings → Members to send a new one.`,
    });
  }

  await assertQuota(supabase, organizationId, "seats", 1);

  const token = nanoid(24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { data: invite, error } = await supabase
    .from("organization_invites")
    .insert({
      organizationId,
      email,
      role,
      token,
      invitedBy,
      status: "PENDING",
      expiresAt,
      projectId: project?.id ?? null,
      projectRole: project?.role ?? null,
    })
    .select("id, email, role, token, expiresAt, status, createdAt")
    .single();

  if (error || !invite) throw inviteInsertError(error);

  const inviteUrl = `${appBaseUrl()}/invite/${token}`;
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";

  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    const cfg = await loadDeliveryConfig(supabase, organizationId);
    const where = project
      ? `the "${project.name}" project in {{organization}}`
      : "{{organization}}";
    const result = await deliverEmail(
      {
        ...cfg,
        templates: {
          emailSubject: `You're invited to join {{organization}} on ResilienceSoft Interview`,
          emailBody: `Hi,\n\nYou were invited to collaborate on ${where} on ResilienceSoft Interview.\n\nOpen this link to join: {{link}}\n\nThis invite expires in 14 days.`,
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
        role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "ADMIN", requireActive: true },
      );

      if (input.role === "ADMIN" || input.role === "OWNER") {
        const caller = await getOrgMembership(
          ctx.supabase,
          input.organizationId,
          ctx.user.id,
        );
        if (caller?.role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              input.role === "OWNER"
                ? "Only an owner can invite someone as Owner"
                : "Only an owner can invite someone as Admin",
          });
        }
      }

      const email = normalizeEmail(input.email);

      if (email === normalizeEmail(ctx.user.email ?? "")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You're already a member of this organization.",
        });
      }

      const { data: existingProfile } = await ctx.supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
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
            message: `${email} is already a member of this organization (${already.role.toLowerCase()}).`,
          });
        }
      }

      return createInvite(ctx.supabase, ctx.user.id, {
        organizationId: input.organizationId,
        email,
        role: input.role,
      });
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
        .select("id, email, role, status, expiresAt, createdAt, token, projectId, projectRole")
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
          projectId: (row.projectId as string | null) ?? null,
          projectRole: (row.projectRole as string | null) ?? null,
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
          "id, email, role, status, expiresAt, organizationId, projectRole, organization:organizations(id, name, slug, status), project:projects(id, name)",
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

      const inviteEmail = normalizeEmail(invite.email as string);
      // auth.users is the source of truth for login (not profiles).
      const existingUser = await findUserByEmail(inviteEmail);

      return {
        email: invite.email as string,
        hasAccount: !!existingUser,
        role: invite.role as string,
        status: expired
          ? invite.status === "PENDING"
            ? "EXPIRED"
            : (invite.status as string)
          : "PENDING",
        expiresAt: invite.expiresAt as string,
        project: (() => {
          const raw = invite.project as unknown;
          const p = (Array.isArray(raw) ? raw[0] : raw) as {
            id: string;
            name: string;
          } | null;
          return p
            ? { name: p.name, role: (invite.projectRole as string) ?? invite.role }
            : null;
        })(),
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
      return acceptOrgInviteForUser(ctx.supabase, ctx.user, input.token);
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
        role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
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

      const callerIsOwner = callerMembership.role === "OWNER";
      const targetIsOwner = targetMembership.role === "OWNER";
      const nextRole = input.role as OrgAssignableRole;

      if (!callerIsOwner && (targetIsOwner || nextRole === "OWNER" || nextRole === "ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an owner can change Owner/Admin roles",
        });
      }

      if (targetIsOwner && nextRole !== "OWNER") {
        const owners = await countOrgOwners(ctx.supabase, input.organizationId);
        if (owners <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot demote the last organization owner. Promote someone else first.",
          });
        }
      }

      const { error } = await ctx.supabase
        .from("organization_members")
        .update({ role: nextRole })
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      if (targetIsOwner && nextRole !== "OWNER") {
        await reassignOrgOwnerIdIfNeeded(
          ctx.supabase,
          input.organizationId,
          input.userId,
        );
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

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use Leave organization to remove yourself.",
        });
      }

      const targetMembership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        input.userId,
      );
      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (targetMembership.role === "OWNER") {
        if (callerMembership.role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only an owner can remove another owner",
          });
        }
        const owners = await countOrgOwners(ctx.supabase, input.organizationId);
        if (owners <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the last organization owner.",
          });
        }
      }

      await ctx.supabase
        .from("organization_members")
        .delete()
        .eq("organizationId", input.organizationId)
        .eq("userId", input.userId);

      // Drop project access for this org too.
      const { data: projects } = await ctx.supabase
        .from("projects")
        .select("id")
        .eq("organizationId", input.organizationId);
      const projectIds = (projects ?? []).map((p) => p.id as string);
      if (projectIds.length > 0) {
        await ctx.supabase
          .from("project_members")
          .delete()
          .eq("userId", input.userId)
          .in("projectId", projectIds);
      }

      if (targetMembership.role === "OWNER") {
        await reassignOrgOwnerIdIfNeeded(
          ctx.supabase,
          input.organizationId,
          input.userId,
        );
      }

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
        role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
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

      if (input.role === "OWNER" && callerMembership.role !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an organization owner can assign the project Owner role",
        });
      }

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
        role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
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

      if (input.role === "OWNER" && callerMembership.role !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an organization owner can add a project Owner",
        });
      }

      const email = normalizeEmail(input.email);

      const { data: project } = await ctx.supabase
        .from("projects")
        .select("id, name")
        .eq("id", input.projectId)
        .eq("organizationId", input.organizationId)
        .maybeSingle();
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This project no longer exists in this organization. Refresh the page and pick another project.",
        });
      }

      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      const orgMembership = profile
        ? await getOrgMembership(ctx.supabase, input.organizationId, profile.id)
        : null;

      // Not in the org yet (or no account): send an org invite that grants
      // this project on accept. Org role stays VIEWER; the project role applies here.
      if (!profile || !orgMembership) {
        const invite = await createInvite(ctx.supabase, ctx.user.id, {
          organizationId: input.organizationId,
          email,
          role: "VIEWER",
          project: { id: project.id as string, name: project.name as string, role: input.role },
        });
        return { outcome: "invited" as const, ...invite };
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
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${email} already has access to "${project.name}". Use the pencil icon to change their project role.`,
        });
      }

      const { error } = await ctx.supabase.from("project_members").insert({
        projectId: input.projectId,
        userId: profile.id,
        role: input.role,
      });

      if (error) {
        console.error("[orgMember] addProjectMember insert failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not add them to the project because of a server error. Try again in a moment.",
        });
      }

      return { outcome: "added" as const, email };
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

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself from the project this way.",
        });
      }

      const targetOrg = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        input.userId,
      );
      if (targetOrg?.role === "OWNER" && callerMembership.role !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an organization owner can remove another owner from a project",
        });
      }

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
        const owners = await countOrgOwners(ctx.supabase, input.organizationId);
        if (owners <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "You are the last owner. Promote another owner before leaving, or delete the organization.",
          });
        }
      }

      await ctx.supabase
        .from("organization_members")
        .delete()
        .eq("organizationId", input.organizationId)
        .eq("userId", ctx.user.id);

      if (membership.role === "OWNER") {
        await reassignOrgOwnerIdIfNeeded(
          ctx.supabase,
          input.organizationId,
          ctx.user.id,
        );
      }

      return { success: true };
    }),
});
