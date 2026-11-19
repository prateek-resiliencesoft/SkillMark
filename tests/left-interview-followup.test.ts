import assert from "node:assert/strict";
import test from "node:test";
import {
  WHATSAPP_FOLLOWUP_META_TEMPLATE,
  followupBodyVariables,
  followupExpiryParts,
} from "../src/lib/messaging/templates";

test("follow-up template has six positional variables and the approved name", () => {
  assert.equal(WHATSAPP_FOLLOWUP_META_TEMPLATE.name, "left_interview_followup");
  const placeholders = WHATSAPP_FOLLOWUP_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}", "{{6}}"]);
});

test("follow-up body variables are ordered name, contact, link, expiry date, expiry time, organization", () => {
  const vars = followupBodyVariables({
    name: "Priya Sharma",
    supportPhone: "+919876543210",
    link: "https://app.example.com/i/invite/abc",
    expiresAt: "2026-11-26T18:29:00.000Z",
    organization: "Acme Corp",
  });
  assert.equal(vars.length, 6);
  assert.deepEqual(vars.slice(0, 3), ["Priya Sharma", "+919876543210", "https://app.example.com/i/invite/abc"]);
  assert.match(vars[3], /^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  assert.match(vars[4], /^\d{1,2}:\d{2}\s?(AM|PM)$/);
  assert.equal(vars[5], "Acme Corp");
});

test("expiry parts split into a readable date and time", () => {
  const { date, time } = followupExpiryParts(new Date("2026-01-05T12:00:00.000Z"));
  assert.match(date, /^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  assert.match(time, /^\d{1,2}:\d{2}\s?(AM|PM)$/);
});
