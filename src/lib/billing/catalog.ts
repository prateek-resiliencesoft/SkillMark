/**
 * Plan catalog shared by quotas, billing UI, admin config, and Stripe mapping.
 * Hardcoded DEFAULT_PLAN_CATALOG is the fallback; live catalog comes from
 * platform_settings.planCatalog (editable in superadmin Config).
 */

export type OrgPlanId = string;

export type OrgLimits = {
  seats: number | null;
  interviews: number | null;
  projects: number | null;
};

export type PlanFeatureFlags = {
  aiSettings: boolean;
  integrations: boolean;
  voiceInterviews: boolean;
  publicForms: boolean;
  usageDashboard: boolean;
};

export type PlanCatalogEntry = {
  id: OrgPlanId;
  name: string;
  blurb: string;
  limits: OrgLimits;
  /** Direct Stripe Price id (preferred for custom plans). */
  stripePriceId: string | null;
  /** Legacy env var name for built-in Stripe prices. */
  stripePriceEnv: string | null;
  purchaseable: boolean;
  features: PlanFeatureFlags;
};

export const DEFAULT_PLAN_FEATURES: PlanFeatureFlags = {
  aiSettings: true,
  integrations: true,
  voiceInterviews: true,
  publicForms: true,
  usageDashboard: true,
};

/** Built-in fallback catalog when DB settings are missing. */
export const DEFAULT_PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    id: "FREE",
    name: "Free",
    blurb: "Try ResilienceSoft Interview with a small team.",
    limits: { seats: null, interviews: 20, projects: 3 },
    stripePriceId: null,
    stripePriceEnv: null,
    purchaseable: false,
    features: { ...DEFAULT_PLAN_FEATURES },
  },
  {
    id: "PRO",
    name: "Pro",
    blurb: "More people, more interviews, room to grow.",
    limits: { seats: null, interviews: 200, projects: 20 },
    stripePriceId: null,
    stripePriceEnv: "STRIPE_PRICE_PRO",
    purchaseable: true,
    features: { ...DEFAULT_PLAN_FEATURES },
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    blurb: "Unlimited seats and interviews for larger teams.",
    limits: { seats: null, interviews: null, projects: null },
    stripePriceId: null,
    stripePriceEnv: "STRIPE_PRICE_ENTERPRISE",
    purchaseable: true,
    features: { ...DEFAULT_PLAN_FEATURES },
  },
  {
    id: "SELF_HOSTED",
    name: "Self-hosted",
    blurb: "Run on your own servers with no plan caps.",
    limits: { seats: null, interviews: null, projects: null },
    stripePriceId: null,
    stripePriceEnv: null,
    purchaseable: false,
    features: { ...DEFAULT_PLAN_FEATURES },
  },
];

/** @deprecated Use DEFAULT_PLAN_CATALOG — kept for existing imports. */
export const PLAN_CATALOG = DEFAULT_PLAN_CATALOG;

export const PROTECTED_PLAN_IDS = new Set(["FREE", "SELF_HOSTED"]);

export function planIdOk(id: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,31}$/.test(id);
}

export function limitsFromCatalog(
  catalog: PlanCatalogEntry[],
): Record<string, OrgLimits> {
  return Object.fromEntries(catalog.map((p) => [p.id, { ...p.limits }]));
}

export function planEntry(
  plan: OrgPlanId | string | null | undefined,
  catalog: PlanCatalogEntry[] = DEFAULT_PLAN_CATALOG,
): PlanCatalogEntry {
  const found = catalog.find((p) => p.id === plan);
  if (found) return found;
  return (
    catalog.find((p) => p.id === "SELF_HOSTED") ??
    DEFAULT_PLAN_CATALOG.find((p) => p.id === "SELF_HOSTED")!
  );
}

export function formatLimit(n: number | null): string {
  return n === null ? "Unlimited" : String(n);
}

/** Resolve Stripe price id for a purchaseable plan, if configured. */
export function stripePriceIdForPlan(
  plan: OrgPlanId,
  catalog: PlanCatalogEntry[] = DEFAULT_PLAN_CATALOG,
): string | null {
  const entry = planEntry(plan, catalog);
  const direct = entry.stripePriceId?.trim();
  if (direct) return direct;
  if (!entry.stripePriceEnv) return null;
  const id = process.env[entry.stripePriceEnv]?.trim();
  return id || null;
}
