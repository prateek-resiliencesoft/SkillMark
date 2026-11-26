/**
 * Shared tenant + platform access guards.
 *
 * Org-scoped procedures go through `requireOrgAccess` so membership and pause
 * state are checked in one place. Platform operators use `requirePlatformAdmin`.
 *
 * Kept free of imports from `./trpc` to avoid circular deps with procedures.
 */
import { TRPCError } from "@trpc/server";
import type { Context } from "./context";

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type OrgStatus = "ACTIVE" | "SUSPENDED" | "DELETED";
export type OrgPlan = string;
export type PlatformRole = "USER" | "ADMIN" | "ENTERPRISE";

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  status: OrgStatus;
  plan: OrgPlan;
  limits: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const ROLE_HIERARCHY: Record<MemberRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Human-facing copy — keep free of internal jargon. */
export const TENANT_COPY = {
  orgNotFound: "Organization not found.",
  orgPaused:
    "This organization is paused. You can browse, but changes are blocked until it is resumed.",
  orgPausedHard:
    "This organization is paused. Ask your admin for help, or contact support.",
  orgDeleted: "This organization is no longer available.",
  notPlatformAdmin: "You don't have access to this area.",
  sessionInvalid: "This interview session is not available.",
  sessionEnded: "This interview session has already ended.",
  needRole: (required: MemberRole, actual: MemberRole) =>
    `You need at least ${required.toLowerCase()} permission. Your current role is ${actual.toLowerCase()}.`,
} as const;

function assertMinRole(actual: MemberRole, required: MemberRole): void {
  if (ROLE_HIERARCHY[actual] < ROLE_HIERARCHY[required]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: TENANT_COPY.needRole(required, actual),
    });
  }
}

async function getOrgMembership(
  supabase: Context["supabase"],
  organizationId: string,
  userId: string,
): Promise<{ role: MemberRole } | null> {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organizationId", organizationId)
    .eq("userId", userId)
    .maybeSingle();

  return data as { role: MemberRole } | null;
}

/**
 * Load the caller's platform role from profiles.
 * Returns USER when the profile row is missing.
 */
export async function getPlatformRole(
  supabase: Context["supabase"],
  userId: string,
): Promise<PlatformRole> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const role = data?.role as PlatformRole | undefined;
  return role ?? "USER";
}

export async function isPlatformAdmin(
  supabase: Context["supabase"],
  userId: string,
): Promise<boolean> {
  return (await getPlatformRole(supabase, userId)) === "ADMIN";
}

/** Assert the caller is a platform admin. */
export async function requirePlatformAdmin(
  supabase: Context["supabase"],
  userId: string,
): Promise<void> {
  if (!(await isPlatformAdmin(supabase, userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: TENANT_COPY.notPlatformAdmin,
    });
  }
}

type RequireOrgOptions = {
  /** Minimum org role. Default VIEWER (any member). */
  minRole?: MemberRole;
  /**
   * When true, skip the pause gate (platform tooling only).
   */
  allowWhenPaused?: boolean;
  /** When true, treat any non-ACTIVE status as a hard block. */
  requireActive?: boolean;
};

/**
 * Resolve org + membership, enforce role and pause rules.
 */
export async function requireOrgAccess(
  supabase: Context["supabase"],
  organizationId: string,
  userId: string,
  options: RequireOrgOptions = {},
): Promise<{ org: OrgRow; membership: { role: MemberRole } }> {
  const minRole = options.minRole ?? "VIEWER";

  const { data: org, error } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, ownerId, status, plan, limits, featureFlags, createdAt, updatedAt",
    )
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !org) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: TENANT_COPY.orgNotFound,
    });
  }

  const typed = org as OrgRow;
  const status = (typed.status ?? "ACTIVE") as OrgStatus;

  if (status === "DELETED") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: TENANT_COPY.orgDeleted,
    });
  }

  const membership = await getOrgMembership(supabase, organizationId, userId);
  if (!membership) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: TENANT_COPY.orgNotFound,
    });
  }

  assertMinRole(membership.role, minRole);

  const writeIntent =
    minRole === "MEMBER" || minRole === "ADMIN" || minRole === "OWNER";

  if (!options.allowWhenPaused) {
    if (options.requireActive && status !== "ACTIVE") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: TENANT_COPY.orgPausedHard,
      });
    }
    if (status === "SUSPENDED" && writeIntent) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: TENANT_COPY.orgPaused,
      });
    }
  }

  return {
    org: { ...typed, status },
    membership,
  };
}

/**
 * Append a platform audit row. Insert failures are swallowed so audit glitches
 * never block the primary operator action.
 */
export async function writePlatformAudit(
  supabase: Context["supabase"],
  entry: {
    actorId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("platform_audit_logs").insert({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? {},
    });
  } catch {
    // no-op
  }
}
