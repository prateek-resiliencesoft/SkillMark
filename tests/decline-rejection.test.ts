import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_EMAIL_BODY,
  APPROVAL_EMAIL_SUBJECT,
  DECLINE_EMAIL_BODY,
  DECLINE_EMAIL_SUBJECT,
  DECLINE_WITH_REASON_EMAIL_BODY,
  DECLINE_WITH_REASON_EMAIL_SUBJECT,
  WHATSAPP_APPROVAL_META_TEMPLATE,
  WHATSAPP_DECLINE_META_TEMPLATE,
  WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE,
  approvalEmailHtml,
  declineEmailHtml,
  declineWithReasonEmailHtml,
  formatApprovalNextRoundDetails,
  formatDeclineDeliverySummary,
  renderApprovalEmailText,
  renderDeclineEmailText,
  renderDeclineWithReasonEmailText,
  whatsappApprovalBodyVariables,
  whatsappDeclineBodyVariables,
  whatsappDeclineWithReasonBodyVariables,
} from "../src/lib/messaging/templates";

test("decline Meta template name and single name variable", () => {
  assert.equal(WHATSAPP_DECLINE_META_TEMPLATE.name, "regarding_your_application_with_resiliencesoft");
  assert.equal(WHATSAPP_DECLINE_META_TEMPLATE.category, "UTILITY");
  const placeholders = WHATSAPP_DECLINE_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}"]);
  assert.match(WHATSAPP_DECLINE_META_TEMPLATE.body, /RESILIENCESOFT/);
  assert.match(WHATSAPP_DECLINE_META_TEMPLATE.body, /Team RESILIENCESOFT/);
});

test("decline email subject and body brand RESILIENCESOFT and substitute name", () => {
  assert.equal(DECLINE_EMAIL_SUBJECT, "Regarding Your Application with RESILIENCESOFT");
  assert.match(DECLINE_EMAIL_BODY, /\{\{name\}\}/);
  const text = renderDeclineEmailText("prateek");
  assert.match(text, /^Hi prateek,/m);
  assert.match(text, /RESILIENCESOFT/);
  assert.match(text, /will not be moving forward/);
  assert.match(text, /Team RESILIENCESOFT/);
  assert.doesNotMatch(text, /\{\{/);
});

test("whatsappDeclineBodyVariables is just the candidate name", () => {
  assert.deepEqual(whatsappDeclineBodyVariables("Priya Sharma"), ["Priya Sharma"]);
});

test("declineEmailHtml has no Start interview CTA", () => {
  const html = declineEmailHtml("prateek");
  assert.match(html, /prateek/);
  assert.doesNotMatch(html, /Start interview/i);
});

test("formatDeclineDeliverySummary", () => {
  assert.equal(
    formatDeclineDeliverySummary(
      { status: "sent" },
      { status: "skipped", error: "No phone number" },
    ),
    "Email sent · WhatsApp skipped (No phone number)",
  );
  assert.equal(
    formatDeclineDeliverySummary({ status: "failed", error: "Resend is not configured" }, { status: "sent" }),
    "Email failed (Resend is not configured) · WhatsApp sent",
  );
  assert.equal(formatDeclineDeliverySummary(undefined, undefined), "");
});

test("approval Meta template name and two variables (name + next-round details)", () => {
  assert.equal(WHATSAPP_APPROVAL_META_TEMPLATE.name, "candidate_next_round_selected");
  assert.equal(WHATSAPP_APPROVAL_META_TEMPLATE.category, "UTILITY");
  const placeholders = WHATSAPP_APPROVAL_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}", "{{2}}"]);
  assert.match(WHATSAPP_APPROVAL_META_TEMPLATE.body, /RESILIENCESOFT/);
  assert.match(WHATSAPP_APPROVAL_META_TEMPLATE.body, /shortlisted/i);
  assert.doesNotMatch(WHATSAPP_APPROVAL_META_TEMPLATE.body, /🎉/);
});

test("approval email subject and body brand RESILIENCESOFT and substitute name + details", () => {
  assert.equal(APPROVAL_EMAIL_SUBJECT, "Congratulations! You've Been Shortlisted – RESILIENCESOFT");
  assert.match(APPROVAL_EMAIL_BODY, /\{\{name\}\}/);
  assert.match(APPROVAL_EMAIL_BODY, /\{\{details\}\}/);
  const text = renderApprovalEmailText("prateek", "na");
  assert.match(text, /^Hi prateek,/m);
  assert.match(text, /^na$/m);
  assert.match(text, /shortlisted for the next round/i);
  assert.match(text, /Team RESILIENCESOFT/);
  assert.doesNotMatch(text, /\{\{/);
});

test("whatsappApprovalBodyVariables is name and next-round details (default na)", () => {
  assert.deepEqual(whatsappApprovalBodyVariables("Priya Sharma"), ["Priya Sharma", "na"]);
  assert.deepEqual(
    whatsappApprovalBodyVariables("Priya Sharma", "Next round: Mon 10am. Join: https://x.test/r2"),
    ["Priya Sharma", "Next round: Mon 10am. Join: https://x.test/r2"],
  );
});

test("approvalEmailHtml has no Start interview CTA", () => {
  const html = approvalEmailHtml("prateek", "na");
  assert.match(html, /prateek/);
  assert.doesNotMatch(html, /Start interview/i);
});

test("formatApprovalNextRoundDetails includes join link and duration", () => {
  const text = formatApprovalNextRoundDetails({
    scheduledAt: "2026-12-01T10:00:00.000Z",
    durationMin: 45,
    candidateLink: "https://app.example/r2/c/tok",
  });
  assert.match(text, /Join: https:\/\/app\.example\/r2\/c\/tok/);
  assert.match(text, /45 min/);
  assert.match(text, /^Next round:/);
});

test("with-reason Meta template name and name+reason variables", () => {
  assert.equal(WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.name, "rejection_notice_with_reason");
  assert.equal(WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.category, "UTILITY");
  const placeholders = WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}", "{{2}}"]);
  assert.match(WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.body, /RESILIENCESOFT/);
  assert.match(WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.body, /Recruitment Team/);
});

test("with-reason email subject Application Update and substitutes name+reason", () => {
  assert.equal(DECLINE_WITH_REASON_EMAIL_SUBJECT, "Application Update");
  assert.match(DECLINE_WITH_REASON_EMAIL_BODY, /\{\{name\}\}/);
  assert.match(DECLINE_WITH_REASON_EMAIL_BODY, /\{\{reason\}\}/);
  const text = renderDeclineWithReasonEmailText(
    "John Doe",
    "We have decided to move forward with candidates whose salary expectations align with our budget.",
  );
  assert.match(text, /^Hi John Doe,/m);
  assert.match(text, /salary expectations align with our budget/);
  assert.match(text, /RESILIENCESOFT Recruitment Team/);
  assert.doesNotMatch(text, /\{\{/);
});

test("whatsappDeclineWithReasonBodyVariables is name then reason", () => {
  assert.deepEqual(
    whatsappDeclineWithReasonBodyVariables("Priya Sharma", "Skills did not match the role requirements."),
    ["Priya Sharma", "Skills did not match the role requirements."],
  );
});

test("declineWithReasonEmailHtml escapes reason and has no Start interview CTA", () => {
  const html = declineWithReasonEmailHtml("prateek", "Budget <script>alert(1)</script>");
  assert.match(html, /prateek/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /Start interview/i);
});
