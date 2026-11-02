/**
 * Stripe webhook signature verification (pure Node — safe for unit tests).
 */
import { createHmac, timingSafeEqual } from "crypto";

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * Verify Stripe-Signature header (t=…,v1=…).
 * See https://stripe.com/docs/webhooks/signatures
 */
export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim(),
): StripeEvent {
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=")];
    }),
  ) as Record<string, string>;

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) throw new Error("Invalid Stripe-Signature header");

  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 60 * 5) {
    throw new Error("Stripe webhook timestamp too old");
  }

  const signed = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookSecret)
    .update(signed)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Stripe webhook signature mismatch");
  }

  return JSON.parse(rawBody) as StripeEvent;
}
