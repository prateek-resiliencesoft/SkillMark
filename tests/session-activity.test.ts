import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPreflightTimeline, type PreflightEvent } from "@/lib/preflight";
import {
  countAnsweredQuestions,
  derivePreflightEvents,
  effectiveDurationSeconds,
  lastMessageAt,
  reachedClosing,
  scopePreflightEvents,
  sessionStatusNote,
} from "@/lib/session-activity";

const T0 = "2026-11-13T10:00:00.000Z";
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

describe("effectiveDurationSeconds", () => {
  it("uses the stored duration when present", () => {
    assert.equal(effectiveDurationSeconds({ totalDurationSeconds: 300 }), 300);
  });
  it("falls back to completedAt − start", () => {
    assert.equal(effectiveDurationSeconds({ interviewBeganAt: T0, completedAt: at(12) }), 720);
  });
  it("falls back to the last message for sessions that never completed", () => {
    assert.equal(effectiveDurationSeconds({ startedAt: T0, completedAt: null }, at(15)), 900);
  });
  it("falls back to the recording length", () => {
    assert.equal(effectiveDurationSeconds({ audioDuration: 918.4 }), 918);
    assert.equal(effectiveDurationSeconds({}), null);
  });
});

describe("answers and closing", () => {
  const msgs = [
    { role: "ASSISTANT", content: "Tell me about yourself", questionId: "q1", timestamp: at(1) },
    { role: "USER", content: "I am a developer", questionId: "q1", timestamp: at(2) },
    { role: "USER", content: "more detail", questionId: "q1", timestamp: at(3) },
    { role: "ASSISTANT", content: "What about scaling?", questionId: "q2", timestamp: at(4) },
    { role: "USER", content: "We used queues", questionId: "q2", timestamp: at(5) },
  ];
  it("counts distinct answered questions", () => {
    assert.equal(countAnsweredQuestions(msgs), 2);
    assert.equal(countAnsweredQuestions([{ role: "USER", content: "hi" }, { role: "USER", content: "there" }]), 2);
  });
  it("finds the last message time", () => {
    assert.equal(lastMessageAt(msgs), at(5));
  });
  it("detects the interviewer's goodbye only as the last line", () => {
    assert.equal(reachedClosing(msgs), false);
    assert.equal(
      reachedClosing([...msgs, { role: "ASSISTANT", content: "Thank you for your time today. Goodbye!" }]),
      true,
    );
    assert.equal(reachedClosing([{ role: "ASSISTANT", content: "Thank you for your time. Any questions?" }]), false);
  });
  it("gives a status note for non-completed sessions only", () => {
    assert.match(sessionStatusNote("ABANDONED") ?? "", /Ended early/);
    assert.match(sessionStatusNote("IN_PROGRESS") ?? "", /in progress/);
    assert.equal(sessionStatusNote("COMPLETED"), null);
  });
});

describe("pre-interview activity", () => {
  const ev = (type: string, extra: Partial<PreflightEvent> = {}): PreflightEvent => ({
    type,
    status: "done",
    createdAt: at(0),
    ...extra,
  });
  it("keeps this session's events even after the invite token was rotated", () => {
    const events = [
      ev("link_opened", { sessionId: "s1", inviteToken: "old" }),
      ev("consent_accepted", { sessionId: "s1", inviteToken: "old" }),
      ev("link_opened", { sessionId: "s2", inviteToken: "new" }),
    ];
    const scoped = scopePreflightEvents(events, { sessionId: "s1", inviteToken: "new" });
    assert.deepEqual(scoped.map((e) => e.type), ["link_opened", "consent_accepted"]);
  });
  it("rebuilds opened/started from the session row when no events exist", () => {
    const derived = derivePreflightEvents({ createdAt: T0, interviewBeganAt: at(3) });
    const items = buildPreflightTimeline(derived).filter((i) => !i.pending);
    assert.deepEqual(items.map((i) => i.type), ["link_opened", "interview_started"]);
    const fromMsg = derivePreflightEvents({ createdAt: T0 }, at(4));
    assert.equal(fromMsg[1]?.createdAt, at(4));
  });
});
