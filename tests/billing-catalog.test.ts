import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  PLAN_CATALOG,
  formatLimit,
  planEntry,
  stripePriceIdForPlan,
} from "@/lib/billing/catalog";
import { verifyStripeWebhook } from "@/lib/billing/stripe-webhook";

describe("billing catalog", () => {
  it("lists four plans with stable ids", () => {
    assert.deepEqual(
      PLAN_CATALOG.map((p) => p.id),
      ["FREE", "PRO", "ENTERPRISE", "SELF_HOSTED"],
    );
  });

  it("formats unlimited as a plain word", () => {
    assert.equal(formatLimit(null), "Unlimited");
    assert.equal(formatLimit(25), "25");
  });

  it("falls back to self-hosted for unknown plans", () => {
    assert.equal(planEntry("nope").id, "SELF_HOSTED");
  });

  it("returns null price when env unset", () => {
    delete process.env.STRIPE_PRICE_PRO;
    assert.equal(stripePriceIdForPlan("PRO"), null);
  });
});

describe("verifyStripeWebhook", () => {
  it("accepts a valid signature", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", "whsec_test")
      .update(`${t}.${body}`)
      .digest("hex");
    const event = verifyStripeWebhook(body, `t=${t},v1=${v1}`);
    assert.equal(event.id, "evt_1");
  });

  it("rejects a bad signature", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    assert.throws(() =>
      verifyStripeWebhook("{}", "t=1,v1=deadbeef"),
    );
  });
});
