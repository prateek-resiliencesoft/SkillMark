/**
 * Public plan catalog shared by quotas, billing UI, and Stripe price mapping.
 * Keep this file free of server-only imports so client components can use it.
 */

export type OrgPlanId = "FREE" | "PRO" | "ENTERPRISE" | "SELF_HOSTED";

export type OrgLimits = {
  seats: number | null;
  interviews: number | null;
  projects: number | null;
};

export type PlanCatalogEntry = {
  id: OrgPlanId;
  name: string;
  blurb: string;
  limits: OrgLimits;
  /** Env var holding the Stripe Price id. */
  stripePriceEnv: string | null;
  purchaseable: boolean;
};

export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    id: "FREE",
    name: "Free",
    blurb: "Try ResilienceSoft Interview with a small team.",
    limits: { seats: null, interviews: 20, projects: 3 },
    stripePriceEnv: null,
    purchaseable: false,
  },
  {
    id: "PRO",
    name: "Pro",
    blurb: "More people, more interviews, room to grow.",
    limits: { seats: null, interviews: 200, projects: 20 },
    stripePriceEnv: "STRIPE_PRICE_PRO",
    purchaseable: true,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    blurb: "Unlimited seats and interviews for larger teams.",
    limits: { seats: null, interviews: null, projects: null },
    stripePriceEnv: "STRIPE_PRICE_ENTERPRISE",
    purchaseable: true,
  },
  {
    id: "SELF_HOSTED",
    name: "Self-hosted",
    blurb: "Run on your own servers with no plan caps.",
    limits: { seats: null, interviews: null, projects: null },
    stripePriceEnv: null,
    purchaseable: false,
  },
];

export function planEntry(
  plan: OrgPlanId | string | null | undefined,
): PlanCatalogEntry {
  return (
    PLAN_CATALOG.find((p) => p.id === plan) ??
    PLAN_CATALOG.find((p) => p.id === "SELF_HOSTED")!
  );
}

export function formatLimit(n: number | null): string {
  return n === null ? "Unlimited" : String(n);
}

/** Resolve Stripe price id for a purchaseable plan, if configured. */
export function stripePriceIdForPlan(plan: OrgPlanId): string | null {
  const entry = planEntry(plan);
  if (!entry.stripePriceEnv) return null;
  const id = process.env[entry.stripePriceEnv]?.trim();
  return id || null;
}
