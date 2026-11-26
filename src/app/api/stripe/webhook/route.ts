import { createLogger } from "@/lib/logger";
import { planFromStripePriceId } from "@/lib/billing/stripe";
import { verifyStripeWebhook } from "@/lib/billing/stripe-webhook";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api/stripe/webhook");

async function findOrgIdByCustomer(
  customerId: string,
): Promise<string | null> {
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("stripeCustomerId", customerId)
    .maybeSingle();
  return typeof org?.id === "string" ? org.id : null;
}

async function applySubscription(
  organizationId: string,
  opts: {
    plan?: string | null;
    subscriptionId?: string | null;
    customerId?: string | null;
    status?: string | null;
  },
) {
  const patch: Record<string, unknown> = {};
  if (opts.subscriptionId) patch.stripeSubscriptionId = opts.subscriptionId;
  if (opts.customerId) patch.stripeCustomerId = opts.customerId;
  if (opts.plan === "PRO" || opts.plan === "ENTERPRISE" || opts.plan === "FREE") {
    patch.plan = opts.plan;
  }
  // unpaid / canceled → drop back to Free (keep self-hosted alone)
  if (
    opts.status === "canceled" ||
    opts.status === "unpaid" ||
    opts.status === "incomplete_expired"
  ) {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("plan")
      .eq("id", organizationId)
      .maybeSingle();
    if (org?.plan !== "SELF_HOSTED") {
      patch.plan = "FREE";
      patch.stripeSubscriptionId = null;
    }
  }

  if (Object.keys(patch).length === 0) return;
  await supabaseAdmin.from("organizations").update(patch).eq("id", organizationId);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let event;
  try {
    event = verifyStripeWebhook(rawBody, req.headers.get("stripe-signature"));
  } catch (err) {
    log.error("Webhook verify failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const obj = event.data.object;

    if (event.type === "checkout.session.completed") {
      const organizationId =
        (obj.client_reference_id as string | null) ||
        ((obj.metadata as Record<string, string> | null)?.organizationId ??
          null);
      const plan =
        (obj.metadata as Record<string, string> | null)?.plan ?? null;
      if (organizationId) {
        await applySubscription(organizationId, {
          plan,
          subscriptionId: (obj.subscription as string | null) ?? null,
          customerId: (obj.customer as string | null) ?? null,
          status: "active",
        });
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.created"
    ) {
      const meta = (obj.metadata as Record<string, string> | null) ?? {};
      let organizationId: string | null =
        typeof meta.organizationId === "string" && meta.organizationId
          ? meta.organizationId
          : null;
      const customerId = (obj.customer as string | null) ?? null;

      if (!organizationId && customerId) {
        organizationId = await findOrgIdByCustomer(customerId);
      }

      const items = obj.items as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined;
      const priceId = items?.data?.[0]?.price?.id ?? null;
      const plan =
        typeof meta.plan === "string" && meta.plan.length > 0
          ? meta.plan
          : planFromStripePriceId(priceId);

      if (organizationId) {
        await applySubscription(organizationId, {
          plan,
          subscriptionId: typeof obj.id === "string" ? obj.id : null,
          customerId,
          status: typeof obj.status === "string" ? obj.status : null,
        });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const meta = (obj.metadata as Record<string, string> | null) ?? {};
      let organizationId: string | null =
        typeof meta.organizationId === "string" && meta.organizationId
          ? meta.organizationId
          : null;
      const customerId = (obj.customer as string | null) ?? null;
      if (!organizationId && customerId) {
        organizationId = await findOrgIdByCustomer(customerId);
      }
      if (organizationId) {
        await applySubscription(organizationId, {
          status: "canceled",
          subscriptionId: null,
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
