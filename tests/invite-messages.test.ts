import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInviteMessageViews,
  mergeInviteMessages,
  parseInviteMessages,
} from "../src/lib/messaging/invite-messages";
import { DEFAULT_TEMPLATES } from "../src/lib/messaging/templates";

test("parseInviteMessages keeps email and whatsapp snapshots", () => {
  const parsed = parseInviteMessages({
    email: {
      subject: "Hi",
      text: "Body",
      sentAt: "2026-01-01T00:00:00.000Z",
      provider: "resend",
      to: "a@b.c",
    },
    whatsapp: {
      text: "WA body",
      sentAt: "2026-01-01T00:00:00.000Z",
      provider: "resilio",
      to: "+911",
      templateName: "interview_invite",
    },
    junk: true,
  });
  assert.equal(parsed.email?.subject, "Hi");
  assert.equal(parsed.whatsapp?.templateName, "interview_invite");
});

test("mergeInviteMessages patches one channel without wiping the other", () => {
  const merged = mergeInviteMessages(
    {
      email: {
        subject: "Old",
        text: "Old body",
        sentAt: "t1",
        provider: "resend",
        to: "a@b.c",
      },
    },
    {
      whatsapp: {
        text: "New WA",
        sentAt: "t2",
        provider: "resilio",
        to: "+91",
      },
    },
  );
  assert.equal(merged.email?.subject, "Old");
  assert.equal(merged.whatsapp?.text, "New WA");
});

test("buildInviteMessageViews prefers exact snapshot and reconstructs otherwise", () => {
  const vars = {
    name: "Priya",
    interviewTitle: "Frontend",
    organization: "Acme",
    link: "https://app.example/i/invite/abc",
    duration: "20 minutes",
    batchName: "Frontend",
    scheduleNotice: "You may start at your convenience.",
  };
  const exact = buildInviteMessageViews({
    inviteMessages: {
      email: {
        subject: "Saved subject",
        text: "Saved body",
        sentAt: "2026-01-02T00:00:00.000Z",
        provider: "brevo",
        to: "priya@acme.test",
      },
    },
    templates: DEFAULT_TEMPLATES,
    vars,
    email: "priya@acme.test",
    phone: "+919999999999",
    emailStatus: "sent",
    whatsappStatus: null,
  });
  assert.equal(exact.find((v) => v.channel === "email")?.source, "exact");
  assert.equal(exact.find((v) => v.channel === "email")?.subject, "Saved subject");
  assert.equal(exact.find((v) => v.channel === "whatsapp")?.source, "reconstructed");
  assert.match(exact.find((v) => v.channel === "whatsapp")?.text ?? "", /Priya/);
});
