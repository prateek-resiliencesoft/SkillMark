import assert from "node:assert/strict";
import test from "node:test";
import {
  WHATSAPP_FOLLOWUP_META_TEMPLATE,
  followupBodyVariables,
  followupExpiryParts,
  normalizeWhatsappPhone,
} from "../src/lib/messaging/templates";

test("follow-up template has six positional variables and the approved name", () => {
  assert.equal(WHATSAPP_FOLLOWUP_META_TEMPLATE.name, "left_interview_followup_v2");
  const placeholders = WHATSAPP_FOLLOWUP_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}", "{{6}}"]);
});

test("follow-up wording says restart, not continue/resume", () => {
  const body = WHATSAPP_FOLLOWUP_META_TEMPLATE.body;
  assert.match(body, /restart your interview using this link: \{\{3\}\}/);
  assert.doesNotMatch(body, /continue|left off|resume/i);
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
  assert.equal(vars[3], "Nov 26, 2026");
  assert.equal(vars[4], "11:59 PM");
  assert.equal(vars[5], "Acme Corp");
});

test("expiry parts split into a readable date and time", () => {
  const { date, time } = followupExpiryParts(new Date("2026-01-05T12:00:00.000Z"));
  assert.match(date, /^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  assert.match(time, /^\d{1,2}:\d{2}\s?(AM|PM)$/);
});

test("expiry is formatted in Asia/Kolkata by default, regardless of server TZ", () => {
  const { date, time } = followupExpiryParts("2026-11-26T18:29:00Z");
  assert.equal(date, "Nov 26, 2026");
  assert.equal(time, "11:59 PM");
  assert.ok(!time.includes("\u202f"));
});

test("expiry honours an explicit timeZone and survives an invalid one", () => {
  const iso = "2026-11-26T18:29:00Z";
  assert.deepEqual(followupExpiryParts(iso, "UTC"), { date: "Nov 26, 2026", time: "6:29 PM" });
  assert.deepEqual(followupExpiryParts(iso, "America/Los_Angeles"), { date: "Nov 26, 2026", time: "10:29 AM" });
  assert.deepEqual(followupExpiryParts(iso, "Not/AZone"), { date: "Nov 26, 2026", time: "11:59 PM" });
  // date rolls over across zones
  assert.equal(followupExpiryParts("2026-11-26T20:00:00Z", "Asia/Kolkata").date, "Nov 27, 2026");
});

test("normalizeWhatsappPhone", () => {
  const n = normalizeWhatsappPhone;
  assert.equal(n("+91 98765-43210"), "+919876543210");
  assert.equal(n("(+91) 98765 43210"), "+919876543210");
  assert.equal(n("0044 7911 123456"), "+447911123456");
  assert.equal(n("98765 43210"), "+919876543210");
  assert.equal(n("919876543210"), "+919876543210");
  assert.equal(n("+14155552671"), "+14155552671");
  // not plausible
  assert.equal(n("5876543210"), null); // 10 digits, not Indian mobile
  assert.equal(n("12345"), null);
  assert.equal(n("+1234567"), null); // 7 digits
  assert.equal(n("+1234567890123456"), null); // 16 digits
  assert.equal(n("abc"), null);
  assert.equal(n(""), null);
  assert.equal(n(null), null);
  assert.equal(n(undefined), null);
});

import { leftFollowupState, needsLeftFollowup } from "../src/lib/left-followup";

test("follow-up option shows only for abandoned candidates it has not reached", () => {
  const abandoned = { status: "ABANDONED" };
  const base = { inviteToken: "tok1", followupSentAt: null, followupSentToken: null };
  assert.equal(needsLeftFollowup(base, abandoned), true);
  assert.equal(needsLeftFollowup(base, { status: "IN_PROGRESS" }), false);
  assert.equal(needsLeftFollowup(base, { status: "COMPLETED" }), false);
  assert.equal(needsLeftFollowup(base, { status: "DISQUALIFIED" }), false);
  assert.equal(needsLeftFollowup(base, null), false);
  assert.equal(needsLeftFollowup({ ...base, inviteToken: null }, abandoned), false);
});

test("follow-up counts as sent only for the current invite link", () => {
  const abandoned = { status: "ABANDONED" };
  const sent = { inviteToken: "tok1", followupSentAt: "2026-11-19T10:00:00.000Z", followupSentToken: "tok1" };
  const s = leftFollowupState(sent, abandoned);
  assert.equal(s.sent, true);
  assert.equal(s.sentAt, "2026-11-19T10:00:00.000Z");
  assert.equal(needsLeftFollowup(sent, abandoned), false);
  // A re-issued link (new token) is not covered by the earlier send.
  assert.equal(needsLeftFollowup({ ...sent, inviteToken: "tok2" }, abandoned), true);
});

test("an expired link is never offered the follow-up: extend the expiry first", () => {
  const abandoned = { status: "ABANDONED" };
  const base = { inviteToken: "tok1", followupSentAt: null, followupSentToken: null };
  const expired = { ...base, expiresAt: new Date(Date.now() - 60_000).toISOString() };
  const live = { ...base, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  assert.equal(leftFollowupState(expired, abandoned).expired, true);
  assert.equal(leftFollowupState(expired, abandoned).applicable, false);
  assert.equal(needsLeftFollowup(expired, abandoned), false);
  assert.equal(leftFollowupState(live, abandoned).expired, false);
  assert.equal(needsLeftFollowup(live, abandoned), true);
});

test("the reason a follow-up was not sent is surfaced, and hidden once sent", () => {
  const abandoned = { status: "ABANDONED" };
  const why = "Add a contact number in Project settings → General first.";
  assert.equal(leftFollowupState({ inviteToken: "t", followupError: why }, abandoned).error, why);
  assert.equal(leftFollowupState({ inviteToken: "t", followupError: "  " }, abandoned).error, null);
  assert.equal(
    leftFollowupState({ inviteToken: "t", followupSentAt: "x", followupSentToken: "t", followupError: why }, abandoned).error,
    null,
  );
});
