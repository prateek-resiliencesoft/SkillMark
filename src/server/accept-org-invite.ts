/**
 * Shared accept-invite core for tRPC acceptInvite and /api/auth/invite-join.
 */
import { TRPCError } from "@trpc/server";
import type { SessionUser } from "@/lib/auth-session";
import { assertQuota } from "./quotas";
import { getOrgMembership } from "./trpc";

type Supabase = Parameters<typeof getOrgMembership>[0];

async function ensureProjectMembersPopulated(
  supabase: Supabase,
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export type AcceptOrgInviteResult = {
  organizationId: string;
  role: string;
};

export async function acceptOrgInviteForUser(
  supabase: Supabase,
  user: SessionUser,
  token: string,
): Promise<AcceptOrgInviteResult> {
  const { data: invite } = await supabase
    .from("organization_invites")
    .select(
      "id, email, role, status, expiresAt, organizationId, projectId, projectRole",
    )
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invite link is not valid. Ask your admin to send a new one.",
    });
  }
  if (invite.status !== "PENDING") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        invite.status === "ACCEPTED"
          ? "This invite has already been used."
          : invite.status === "REVOKED"
            ? "This invite was cancelled by an admin. Ask them to send a new one."
            : "This invite has expired. Ask your admin for a new one.",
    });
  }

  if (new Date(invite.expiresAt as string).getTime() < Date.now()) {
    await supabase
      .from("organization_invites")
      .update({ status: "EXPIRED" })
      .eq("id", invite.id);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This invite has expired. Ask your admin for a new one.",
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  const userEmail = normalizeEmail((profile?.email as string) || user.email || "");
  if (!userEmail || userEmail !== normalizeEmail(invite.email as string)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This invite was sent to ${invite.email}, but you're signed in as ${userEmail || "another account"}. Switch to ${invite.email} to accept it.`,
    });
  }

  const { data: org } = await supabase
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
      message: "This organization is paused. Ask the owner to resume it first.",
    });
  }

  const projectId = invite.projectId as string | null;
  if (projectId) {
    await ensureProjectMembersPopulated(
      supabase,
      invite.organizationId as string,
      projectId,
    );
  }

  const existing = await getOrgMembership(
    supabase,
    invite.organizationId as string,
    user.id,
  );
  if (!existing) {
    await assertQuota(supabase, invite.organizationId as string, "seats", 1);
    const { error: memberErr } = await supabase.from("organization_members").insert({
      organizationId: invite.organizationId,
      userId: user.id,
      role: invite.role,
    });
    if (memberErr) {
      console.error("[orgMember] accept insert failed", memberErr);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Could not add you to the organization because of a server error. Try again in a moment.",
      });
    }
  }

  if (projectId) {
    const { error: projectErr } = await supabase.from("project_members").upsert(
      {
        projectId,
        userId: user.id,
        role: (invite.projectRole as string) ?? invite.role,
      },
      { onConflict: "projectId,userId" },
    );
    if (projectErr) {
      console.error("[orgMember] accept project insert failed", projectErr);
    }
  }

  await supabase
    .from("organization_invites")
    .update({
      status: "ACCEPTED",
      acceptedAt: new Date().toISOString(),
      acceptedBy: user.id,
    })
    .eq("id", invite.id);

  return {
    organizationId: invite.organizationId as string,
    role: invite.role as string,
  };
}
