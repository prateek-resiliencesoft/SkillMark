/**
 * Minimal Stripe REST helpers (no SDK). Billing is optional — when
 * STRIPE_SECRET_KEY is unset, checkout/portal stay disabled.
 */
import "server-only";
import type { OrgPlanId } from "./catalog";
import { stripePriceIdForPlan } from "./catalog";

export { verifyStripeWebhook, type StripeEvent } from "./stripe-webhook";

const STRIPE_API = "https://api.stripe.com/v1";

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function isStripeBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function secret(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe is not configured");
  return key;
}

async function stripeForm<T>(
  path: string,
  body: Record<string, string | number | undefined>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe HTTP ${res.status}`);
  }
  return json;
}

export async function createStripeCustomer(opts: {
  email: string;
  name: string;
  organizationId: string;
}): Promise<{ id: string }> {
  return stripeForm<{ id: string }>("/customers", {
    email: opts.email,
    name: opts.name,
    "metadata[organizationId]": opts.organizationId,
  });
}

export async function createCheckoutSession(opts: {
  customerId: string;
  organizationId: string;
  plan: OrgPlanId;
  /** Prefer explicit price from the live plan catalog. */
  priceId?: string | null;
}): Promise<{ url: string; id: string }> {
  const price = opts.priceId?.trim() || stripePriceIdForPlan(opts.plan);
  if (!price) {
    throw new Error(`No Stripe price configured for ${opts.plan}`);
  }
  const base = appBase();
  const session = await stripeForm<{ id: string; url: string | null }>(
    "/checkout/sessions",
    {
      mode: "subscription",
      customer: opts.customerId,
      "line_items[0][price]": price,
      "line_items[0][quantity]": 1,
      success_url: `${base}/org/settings/plan?checkout=success`,
      cancel_url: `${base}/org/settings/plan?checkout=cancelled`,
      client_reference_id: opts.organizationId,
      "metadata[organizationId]": opts.organizationId,
      "metadata[plan]": opts.plan,
      "subscription_data[metadata][organizationId]": opts.organizationId,
      "subscription_data[metadata][plan]": opts.plan,
    },
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { id: session.id, url: session.url };
}

export async function createBillingPortalSession(opts: {
  customerId: string;
}): Promise<{ url: string }> {
  const base = appBase();
  return stripeForm<{ url: string }>("/billing_portal/sessions", {
    customer: opts.customerId,
    return_url: `${base}/org/settings/plan`,
  });
}

/** Map a Stripe price id back to our plan, if known (built-in catalog). */
export function planFromStripePriceId(
  priceId: string | null | undefined,
  catalog?: { id: string; stripePriceId?: string | null }[],
): OrgPlanId | null {
  if (!priceId) return null;
  if (catalog) {
    for (const p of catalog) {
      const direct = p.stripePriceId?.trim();
      if (direct && direct === priceId) return p.id;
      if (stripePriceIdForPlan(p.id) === priceId) return p.id;
    }
  }
  for (const plan of ["PRO", "ENTERPRISE"] as const) {
    if (stripePriceIdForPlan(plan) === priceId) return plan;
  }
  return null;
}
