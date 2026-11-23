import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_EMAIL_BODY,
  APPROVAL_EMAIL_SUBJECT,
  DECLINE_EMAIL_BODY,
  DECLINE_EMAIL_SUBJECT,
  WHATSAPP_APPROVAL_META_TEMPLATE,
  WHATSAPP_DECLINE_META_TEMPLATE,
  approvalEmailHtml,
  declineEmailHtml,
  formatDeclineDeliverySummary,
  renderApprovalEmailText,
  renderDeclineEmailText,
  whatsappApprovalBodyVariables,
  whatsappDeclineBodyVariables,
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

test("approval Meta template name and single name variable", () => {
  assert.equal(WHATSAPP_APPROVAL_META_TEMPLATE.name, "candidate_next_round_selected");
  assert.equal(WHATSAPP_APPROVAL_META_TEMPLATE.category, "UTILITY");
  const placeholders = WHATSAPP_APPROVAL_META_TEMPLATE.body.match(/\{\{\d\}\}/g) ?? [];
  assert.deepEqual(placeholders, ["{{1}}"]);
  assert.match(WHATSAPP_APPROVAL_META_TEMPLATE.body, /RESILIENCESOFT/);
  assert.match(WHATSAPP_APPROVAL_META_TEMPLATE.body, /shortlisted/i);
  assert.doesNotMatch(WHATSAPP_APPROVAL_META_TEMPLATE.body, /🎉/);
});

test("approval email subject and body brand RESILIENCESOFT and substitute name", () => {
  assert.equal(APPROVAL_EMAIL_SUBJECT, "Congratulations! You've Been Shortlisted – RESILIENCESOFT");
  assert.match(APPROVAL_EMAIL_BODY, /\{\{name\}\}/);
  const text = renderApprovalEmailText("prateek");
  assert.match(text, /^Hi prateek,/m);
  assert.match(text, /shortlisted for the next round/i);
  assert.match(text, /Team RESILIENCESOFT/);
  assert.doesNotMatch(text, /\{\{/);
});

test("whatsappApprovalBodyVariables is just the candidate name", () => {
  assert.deepEqual(whatsappApprovalBodyVariables("Priya Sharma"), ["Priya Sharma"]);
});

test("approvalEmailHtml has no Start interview CTA", () => {
  const html = approvalEmailHtml("prateek");
  assert.match(html, /prateek/);
  assert.doesNotMatch(html, /Start interview/i);
});
