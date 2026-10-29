import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeWebhookSignature, verifyWebhookSignature } from "@/lib/messaging/webhooks";

describe("webhooks security & signatures", () => {
  const secret = "test-webhook-secret-key-12345";
  const payload = JSON.stringify({
    event: "candidate.invited",
    timestamp: "2026-10-28T12:00:00.000Z",
    organizationId: "org-1",
    data: {
      candidateId: "c-1",
      name: "Priya Sharma",
      email: "priya@example.com",
    },
  });

  it("computes deterministic HMAC SHA-256 signatures", () => {
    const sig1 = computeWebhookSignature(payload, secret);
    const sig2 = computeWebhookSignature(payload, secret);
    assert.equal(sig1, sig2);
    assert.ok(sig1.startsWith("sha256="));
    assert.equal(sig1.length, 7 + 64); // "sha256=" + 64 hex characters
  });

  it("verifies valid signatures", () => {
    const sig = computeWebhookSignature(payload, secret);
    assert.equal(verifyWebhookSignature(payload, sig, secret), true);
  });

  it("rejects tampered payloads or incorrect secrets", () => {
    const sig = computeWebhookSignature(payload, secret);
    const tamperedPayload = payload.replace("priya@example.com", "hacker@example.com");
    assert.equal(verifyWebhookSignature(tamperedPayload, sig, secret), false);
    assert.equal(verifyWebhookSignature(payload, sig, "wrong-secret"), false);
  });
});
