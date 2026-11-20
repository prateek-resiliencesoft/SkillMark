import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { type Context } from "./context";
import { TENANT_COPY, type OrgStatus } from "./tenant";

const FRIENDLY_MESSAGES: Partial<Record<string, string>> = {
  FORBIDDEN: "You don't have permission to perform this action. Please contact your admin for access.",
  UNAUTHORIZED: "You need to sign in to continue.",
  NOT_FOUND: "The requested resource was not found.",
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const hasCustomMessage = error.message !== error.code;
    return {
      ...shape,
      message: hasCustomMessage
        ? error.message
        : FRIENDLY_MESSAGES[error.code] ?? shape.message,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const enforceUserIsAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

/**
 * Platform admin only. Checks profiles.role === 'ADMIN'.
 * Imported lazily inside the middleware to keep module init order clean.
 */
const enforcePlatformAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const { requirePlatformAdmin } = await import("./tenant");
  await requirePlatformAdmin(ctx.supabase, ctx.user.id);
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

export const platformProcedure = t.procedure.use(enforcePlatformAdmin);

/* ------------------------------------------------------------------ */
/*  RBAC helpers                                                       */
/* ------------------------------------------------------------------ */

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const ROLE_HIERARCHY: Record<MemberRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasMinRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}

export function assertMinRole(actual: MemberRole, required: MemberRole): void {
  if (!hasMinRole(actual, required)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You need at least ${required} permission to perform this action. Your current role is ${actual}.`,
    });
  }
}

export type OrgMembership = { role: MemberRole; orgStatus: OrgStatus };

/** Blocks writes on paused (or any non-ACTIVE) organizations; reads stay allowed. */
export function assertOrgWritable(membership: { orgStatus: OrgStatus }): void {
  if (membership.orgStatus !== "ACTIVE") {
    throw new TRPCError({ code: "FORBIDDEN", message: TENANT_COPY.orgPaused });
  }
}

/**
 * Look up the caller's org membership. Returns null if not a member or the
 * organization is missing / DELETED. Pass `{ write: true }` for write intent:
 * SUSPENDED organizations then throw FORBIDDEN (same policy as requireOrgAccess).
 */
export async function getOrgMembership(
  supabase: Context["supabase"],
  organizationId: string,
  userId: string,
  options: { write?: boolean } = {},
): Promise<OrgMembership | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organizationId", organizationId)
    .eq("userId", userId)
    .maybeSingle();
  if (!data) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("status")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return null;

  const orgStatus = ((org.status as OrgStatus | null) ?? "ACTIVE") as OrgStatus;
  if (orgStatus === "DELETED") return null;

  const membership: OrgMembership = { role: data.role as MemberRole, orgStatus };
  if (options.write) assertOrgWritable(membership);
  return membership;
}

/**
 * Check if a user has access to a specific project. Fails closed unless the
 * project exists in a non-deleted organization the user belongs to.
 * If project_members has not been populated yet (no entries), all org
 * members have access. Once entries exist, only listed users may access.
 */
export async function hasProjectAccess(
  supabase: Context["supabase"],
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data: project } = await supabase
    .from("projects")
    .select("organizationId")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.organizationId) return false;
  if (!(await getOrgMembership(supabase, project.organizationId as string, userId))) {
    return false;
  }

  const { count } = await supabase
    .from("project_members")
    .select("id", { count: "exact", head: true })
    .eq("projectId", projectId);

  if ((count ?? 0) === 0) return true;

  const { data } = await supabase
    .from("project_members")
    .select("id")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .single();

  return !!data;
}

/**
 * Return the effective role for a user in a project context.
 * Uses the higher of the org role and project-specific role.
 */
export async function getEffectiveProjectRole(
  supabase: Context["supabase"],
  projectId: string,
  userId: string,
  orgRole: MemberRole,
): Promise<MemberRole> {
  const { data: pm } = await supabase
    .from("project_members")
    .select("role")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .single();

  if (!pm) return orgRole;

  const projectRole = pm.role as MemberRole;
  return ROLE_HIERARCHY[projectRole] >= ROLE_HIERARCHY[orgRole]
    ? projectRole
    : orgRole;
}

/**
 * From a list of project IDs, return only those the user can access: the
 * project must live in a non-deleted org the user belongs to and pass the
 * project_members ACL. With `minRole`, the effective role (higher of org and
 * project role) must also meet it.
 */
export async function filterAccessibleProjectIds(
  supabase: Context["supabase"],
  projectIds: string[],
  userId: string,
  options: { minRole?: MemberRole } = {},
): Promise<string[]> {
  if (projectIds.length === 0) return [];

  const { data: projects } = await supabase
    .from("projects")
    .select("id, organizationId")
    .in("id", projectIds);
  const orgByProject = new Map<string, string>();
  for (const p of projects ?? []) {
    if (p.organizationId) orgByProject.set(p.id as string, p.organizationId as string);
  }
  const orgIds = Array.from(new Set(orgByProject.values()));
  if (orgIds.length === 0) return [];

  const [{ data: memberships }, { data: orgs }, { data: allPm }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("organizationId, role")
      .eq("userId", userId)
      .in("organizationId", orgIds),
    supabase.from("organizations").select("id, status").in("id", orgIds),
    supabase
      .from("project_members")
      .select("projectId, userId, role")
      .in("projectId", projectIds),
  ]);

  const liveOrgs = new Set(
    (orgs ?? [])
      .filter((o) => (o.status ?? "ACTIVE") !== "DELETED")
      .map((o) => o.id as string),
  );
  const orgRole = new Map<string, MemberRole>();
  for (const m of memberships ?? []) {
    if (liveOrgs.has(m.organizationId as string)) {
      orgRole.set(m.organizationId as string, m.role as MemberRole);
    }
  }

  const pmByProject = new Map<string, Map<string, MemberRole>>();
  for (const pm of allPm ?? []) {
    if (!pmByProject.has(pm.projectId)) {
      pmByProject.set(pm.projectId, new Map());
    }
    pmByProject.get(pm.projectId)!.set(pm.userId, pm.role as MemberRole);
  }

  return projectIds.filter((pid) => {
    const orgId = orgByProject.get(pid);
    const role = orgId ? orgRole.get(orgId) : undefined;
    if (!role) return false;
    const members = pmByProject.get(pid);
    let effective: MemberRole = role;
    if (members && members.size > 0) {
      const projectRole = members.get(userId);
      if (!projectRole) return false;
      if (ROLE_HIERARCHY[projectRole] > ROLE_HIERARCHY[role]) effective = projectRole;
    }
    return !options.minRole || hasMinRole(effective, options.minRole);
  });
}
