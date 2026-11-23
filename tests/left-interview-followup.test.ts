import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLLOWUP_BRAND,
  FOLLOWUP_EMAIL_SUBJECT,
  WHATSAPP_FOLLOWUP_META_TEMPLATE,
  followupBodyVariables,
  followupExpiryParts,
  followupRolePhrase,
  formatFollowupExpiryLabel,
  normalizeWhatsappPhone,
  renderFollowupEmailText,
} from "../src/lib/messaging/templates";

test("follow-up template has five positional variables and the approved name", () => {
  assert.equal(WHATSAPP_FOLLOWUP_META_TEMPLATE.name, "interview_incomplete_reminder");
  const placeholders = WHATSAPP_FOLLOWUP_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}", "{{2}}", "{{3}}", "{{4}}", "{{5}}"]);
});

test("follow-up body matches interview_incomplete_reminder wording", () => {
  const body = WHATSAPP_FOLLOWUP_META_TEMPLATE.body;
  assert.match(body, /Your interview with \{\{2\}\}/);
  assert.match(body, /Resume Interview: \{\{3\}\}/);
  assert.match(body, /before \{\{4\}\}/);
  assert.match(body, /contact \{\{5\}\}/);
  assert.match(body, /Team RESILIENCESOFT/);
});

test("follow-up body variables match Meta slots: name, role phrase, link, expiry, phone", () => {
  const vars = followupBodyVariables({
    name: "Aniket kumar",
    supportPhone: "+917879848993",
    link: "https://dev.resiliencesoftinterview.com/i/invite/peccezgy84y4",
    expiresAt: "2026-11-26T18:29:00.000Z",
    position: "Senior .NET & Python Developer Assessment",
  });
  assert.equal(vars.length, 5);
  assert.equal(vars[0], "Aniket kumar"); // {{1}} Hi …
  assert.equal(vars[1], "RESILIENCESOFT For Senior .NET & Python Developer Assessment"); // {{2}}
  assert.equal(vars[2], "https://dev.resiliencesoftinterview.com/i/invite/peccezgy84y4"); // {{3}} Resume
  assert.equal(vars[3], "2026-11-26 at 23.59"); // {{4}} live expiry (IST)
  assert.equal(vars[4], "+917879848993"); // {{5}} contact
  assert.equal(FOLLOWUP_BRAND, "RESILIENCESOFT");
});

test("followupRolePhrase does not double the brand prefix", () => {
  assert.equal(followupRolePhrase("MERN Position"), "RESILIENCESOFT For MERN Position");
  assert.equal(followupRolePhrase("RESILIENCESOFT For MERN Position"), "RESILIENCESOFT For MERN Position");
});

test("follow-up email subject and body brand RESILIENCESOFT", () => {
  assert.equal(FOLLOWUP_EMAIL_SUBJECT, "Regarding Your Interview with RESILIENCESOFT");
  const text = renderFollowupEmailText({
    name: "prateek",
    supportPhone: "+919201996377",
    link: "https://example.com/restart",
    expiresAt: "2026-12-31T18:29:00.000Z",
    position: "MERN Position",
  });
  assert.match(text, /^Hi prateek,/m);
  assert.match(text, /RESILIENCESOFT For MERN Position/);
  assert.match(text, /https:\/\/example.com\/restart/);
  assert.match(text, /Team RESILIENCESOFT/);
});

test("expiry parts use Meta-style YYYY-MM-DD and HH.mm in Asia/Kolkata", () => {
  const { date, time } = followupExpiryParts("2026-11-26T18:29:00.000Z");
  assert.equal(date, "2026-11-26");
  assert.equal(time, "23.59");
  assert.equal(formatFollowupExpiryLabel("2026-11-26T18:29:00.000Z"), "2026-11-26 at 23.59");
});

test("expiry label tracks the live expiresAt value (dynamic)", () => {
  assert.equal(formatFollowupExpiryLabel("2026-12-31T18:29:00.000Z"), "2026-12-31 at 23.59");
  assert.equal(formatFollowupExpiryLabel("2027-01-15T06:30:00.000Z"), "2027-01-15 at 12.00");
});

test("expiry honours an explicit timeZone and survives an invalid one", () => {
  const iso = "2026-11-26T18:29:00Z";
  assert.deepEqual(followupExpiryParts(iso, "UTC"), { date: "2026-11-26", time: "18.29" });
  assert.deepEqual(followupExpiryParts(iso, "America/Los_Angeles"), { date: "2026-11-26", time: "10.29" });
  assert.deepEqual(followupExpiryParts(iso, "Not/AZone"), { date: "2026-11-26", time: "23.59" });
  assert.equal(followupExpiryParts("2026-11-26T20:00:00Z", "Asia/Kolkata").date, "2026-11-27");
});

test("follow-up email uses the same dynamic expiry label", () => {
  const text = renderFollowupEmailText({
    name: "prateek",
    supportPhone: "+919201996377",
    link: "https://example.com/restart",
    expiresAt: "2026-12-31T18:29:00.000Z",
    position: "MERN Position",
  });
  assert.match(text, /before 2026-12-31 at 23\.59/);
});

test("normalizeWhatsappPhone", () => {
  const n = normalizeWhatsappPhone;
  assert.equal(n("+91 98765-43210"), "+919876543210");
  assert.equal(n("(+91) 98765 43210"), "+919876543210");
  assert.equal(n("0044 7911 123456"), "+447911123456");
  assert.equal(n("98765 43210"), "+919876543210");
  assert.equal(n("919876543210"), "+919876543210");
  assert.equal(n("+14155552671"), "+14155552671");
  assert.equal(n("5876543210"), null);
  assert.equal(n("12345"), null);
  assert.equal(n("+1234567"), null);
  assert.equal(n("+1234567890123456"), null);
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

test("follow-up status is shown for anyone who left, and stays visible once sent", () => {
  const base = { inviteToken: "tok1", followupSentAt: null, followupSentToken: null };
  assert.equal(leftFollowupState(base, { status: "ABANDONED" }).relevant, true);
  assert.equal(leftFollowupState(base, { status: "COMPLETED" }).relevant, false);
  assert.equal(leftFollowupState(base, { status: "NOT_STARTED" }).relevant, false);
  const sentExpired = {
    ...base,
    followupSentAt: "2026-11-19T10:00:00.000Z",
    followupSentToken: "tok1",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const s = leftFollowupState(sentExpired, { status: "ABANDONED" });
  assert.equal(s.relevant, true);
  assert.equal(s.sent, true);
  assert.equal(s.applicable, false);
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
