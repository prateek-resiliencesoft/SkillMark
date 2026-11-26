import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeDelivery } from "../src/lib/messaging/delivery-toast";

test("whatsapp sent + email failed is partial, not destructive", () => {
  const s = summarizeDelivery({
    whatsapp: { status: "sent" },
    email: { status: "failed", error: "Resend is not configured" },
  });
  assert.equal(s.destructive, false);
  assert.equal(s.sent, 1);
  assert.equal(s.failed, 1);
  assert.match(s.title, /Partial/i);
  assert.match(s.description, /WhatsApp: sent/);
  assert.match(s.description, /Email: failed/);
});

test("all failed is destructive", () => {
  const s = summarizeDelivery({
    email: { status: "failed", error: "boom" },
  });
  assert.equal(s.destructive, true);
  assert.equal(s.sent, 0);
});

test("skipped is not treated as failed", () => {
  const s = summarizeDelivery({
    whatsapp: { status: "sent" },
    email: { status: "skipped", error: "No email address" },
  });
  assert.equal(s.destructive, false);
  assert.equal(s.failed, 0);
  assert.match(s.title, /sent|resent/i);
});
