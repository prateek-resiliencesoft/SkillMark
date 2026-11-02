/**
 * Plan quotas for organizations.
 *
 * Limits come from the plan catalog, then org.limits overrides any key.
 * `null` means unlimited. User-facing errors stay plain English.
 */
import { TRPCError } from "@trpc/server";
import {
  PLAN_CATALOG,
  type OrgLimits,
  type OrgPlanId,
} from "@/lib/billing/catalog";
import { defaultPlanLimitsMap } from "@/lib/platform-settings";
import type { Context } from "./context";
import { loadPlatformSettings } from "./platform-settings";
import type { OrgPlan } from "./tenant";

export type { OrgLimits };
export type QuotaKind = keyof OrgLimits;

const FALLBACK_PLAN_LIMITS: Record<OrgPlanId, OrgLimits> = Object.fromEntries(
  PLAN_CATALOG.map((p) => [p.id, p.limits]),
) as Record<OrgPlanId, OrgLimits>;

const QUOTA_COPY: Record<QuotaKind, string> = {
  seats:
    "This organization has reached its people limit. Pause an invite, remove someone, or upgrade the plan.",
  interviews:
    "This organization has reached its interview limit. Archive older interviews or upgrade the plan.",
  projects:
    "This organization has reached its project limit. Upgrade the plan to add more.",
};

function asFiniteLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
}

/** Merge plan defaults with per-org overrides from organizations.limits. */
export function resolveOrgLimits(
  plan: OrgPlan | string | null | undefined,
  overrides?: Record<string, unknown> | null,
  planDefaults?: Record<OrgPlanId, OrgLimits> | null,
): OrgLimits {
  const catalog = planDefaults ?? FALLBACK_PLAN_LIMITS;
  const base =
    catalog[(plan as OrgPlanId) ?? "SELF_HOSTED"] ??
    catalog.SELF_HOSTED ??
    defaultPlanLimitsMap().SELF_HOSTED;
  const out: OrgLimits = { ...base };
  if (!overrides) return out;

  for (const key of ["seats", "interviews", "projects"] as const) {
    const parsed = asFiniteLimit(overrides[key]);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

export async function loadOrgLimits(
  supabase: Context["supabase"],
  organizationId: string,
): Promise<{ plan: OrgPlan; limits: OrgLimits }> {
  const [{ data }, platform] = await Promise.all([
    supabase
      .from("organizations")
      .select("plan, limits")
      .eq("id", organizationId)
      .maybeSingle(),
    loadPlatformSettings(supabase),
  ]);

  const plan = ((data?.plan as OrgPlan) ?? "SELF_HOSTED") as OrgPlan;
  const limits = resolveOrgLimits(
    plan,
    (data?.limits as Record<string, unknown> | null) ?? null,
    platform.planLimits,
  );
  return { plan, limits };
}

export async function countOrgSeats(
  supabase: Context["supabase"],
  organizationId: string,
): Promise<number> {
  const [{ count: members }, { count: pending }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organizationId", organizationId),
    supabase
      .from("organization_invites")
      .select("id", { count: "exact", head: true })
      .eq("organizationId", organizationId)
      .eq("status", "PENDING"),
  ]);
  return (members ?? 0) + (pending ?? 0);
}

export async function countOrgInterviews(
  supabase: Context["supabase"],
  organizationId: string,
): Promise<number> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organizationId", organizationId);
  const projectIds = (projects ?? []).map((p) => p.id as string);
  if (projectIds.length === 0) return 0;
  const { count } = await supabase
    .from("interviews")
    .select("id", { count: "exact", head: true })
    .in("projectId", projectIds);
  return count ?? 0;
}

export async function countOrgProjects(
  supabase: Context["supabase"],
  organizationId: string,
): Promise<number> {
  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("organizationId", organizationId);
  return count ?? 0;
}

/**
 * Throw FORBIDDEN when `used + add` would exceed the resolved limit.
 * Unlimited (`null`) always passes.
 */
export async function assertQuota(
  supabase: Context["supabase"],
  organizationId: string,
  kind: QuotaKind,
  add = 1,
): Promise<OrgLimits> {
  const { limits } = await loadOrgLimits(supabase, organizationId);
  const cap = limits[kind];
  if (cap === null) return limits;

  let used = 0;
  if (kind === "seats") used = await countOrgSeats(supabase, organizationId);
  else if (kind === "interviews")
    used = await countOrgInterviews(supabase, organizationId);
  else used = await countOrgProjects(supabase, organizationId);

  if (used + add > cap) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: QUOTA_COPY[kind],
    });
  }
  return limits;
}
