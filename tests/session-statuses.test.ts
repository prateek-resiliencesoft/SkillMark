import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleVoiceSave, type VoiceSaveOps } from "@/app/api/voice/save/logic";
import { formatSessionStatusLabel } from "@/lib/preflight";
import {
  canAbandon,
  canRestartFromLink,
  completionEndReason,
  decideStart,
  HEARTBEAT_GRACE_MS,
  inviteSessionAction,
  isHeartbeatStale,
  isLinkConsumed,
  isQuitEarly,
  needsFreshInviteLink,
} from "@/lib/session-link";
import { decideReport } from "@/lib/session-report-policy";
import { sessionStatusNote } from "@/lib/session-activity";
import { beaconBodies } from "@/lib/transcript/outbox";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

// Pre-flight: link opened / photo / mic check / screen share, interview not begun.
const preflight = { status: "IN_PROGRESS", interviewBeganAt: null, preflightStep: "mic_check", lastActivityAt: ago(5 * HOUR) };
// Interview running.
const began = { status: "IN_PROGRESS", interviewBeganAt: ago(60_000), lastHeartbeatAt: ago(1_000) };

describe("A: pre-flight never abandons", () => {
  it("leave / reload / network loss before the interview starts cannot abandon", () => {
    assert.equal(canAbandon(preflight), false);
    assert.equal(isHeartbeatStale(preflight, NOW), false);
    assert.equal(canAbandon({ status: "IN_PROGRESS" }), false);
  });

  it("a quiet pre-flight session reads Not Started, never Abandoned", () => {
    assert.equal(formatSessionStatusLabel(preflight, NOW), "Not Started");
    assert.equal(formatSessionStatusLabel({ ...preflight, lastActivityAt: ago(1_000) }, NOW), "Setting up");
  });

  it("the same link keeps working: reused, start allowed, no fresh link needed", () => {
    assert.equal(inviteSessionAction(preflight.status), "reuse");
    assert.equal(isLinkConsumed(preflight.status), false);
    assert.deepEqual(decideStart(preflight, { nowMs: NOW }), { action: "start" });
    assert.equal(needsFreshInviteLink({ session: preflight, nowMs: NOW }), false);
  });
});

describe("B: started + involuntary disruption abandons", () => {
  it("only a begun, in-progress interview can be abandoned", () => {
    assert.equal(canAbandon(began), true);
    assert.equal(canAbandon({ ...began, status: "COMPLETED" }), false);
    assert.equal(canAbandon({ ...began, status: "ABANDONED" }), false);
  });

  it("heartbeat loss after start goes stale", () => {
    assert.equal(isHeartbeatStale(began, NOW), false);
    assert.equal(isHeartbeatStale({ ...began, lastHeartbeatAt: ago(HEARTBEAT_GRACE_MS + 1) }, NOW), true);
  });

  it("an abandoned link is reusable (fresh attempt), not consumed-forever", () => {
    assert.equal(canRestartFromLink("ABANDONED"), true);
    assert.equal(inviteSessionAction("ABANDONED"), "restart");
  });
});

function voiceOps(opts: { status?: string; finished?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];
  const reports: { force: boolean }[] = [];
  const ops: VoiceSaveOps = {
    async insertMessages() {},
    async loadSessionForCompletion() {
      return {
        status: opts.status ?? "IN_PROGRESS",
        startedAt: "2026-03-11T10:00:00.000Z",
        interview: { title: "T", objective: null, language: "en", userId: "u", projectId: "p", assessmentCriteria: null, questions: [] },
      };
    },
    async loadFirstMessageTimestamp() {
      return "2026-03-11T10:01:00.000Z";
    },
    async loadSessionForProgress() {
      return null;
    },
    async updateSession(_id, payload) {
      updates.push(payload);
    },
    async generateSummary() {},
    log: { info() {}, error() {} },
    now: () => new Date("2026-03-11T10:05:00.000Z"),
    scheduleReport: (_id, o) => void reports.push(o),
    interviewFinished: async () => !!opts.finished,
  };
  return { ops, updates, reports };
}

describe("C: explicit quit -> COMPLETED + quit tag", () => {
  const lines = [{ role: "user", content: "my answer" }];

  it("reason quit completes with endReason QUIT and still schedules the report", async () => {
    const t = voiceOps();
    const r = await handleVoiceSave({ sessionId: "s1", messages: lines, complete: true, reason: "quit" }, t.ops);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "COMPLETED");
    assert.equal(t.updates[0]?.status, "COMPLETED");
    assert.equal(t.updates[0]?.endReason, "QUIT");
    assert.deepEqual(t.reports, [{ force: false }]);
  });

  it("a normal completion keeps endReason COMPLETED (no quit tag)", async () => {
    const t = voiceOps();
    await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(t.updates[0]?.endReason, "COMPLETED");
  });

  it("an unknown reason is not a quit", async () => {
    const t = voiceOps();
    await handleVoiceSave({ sessionId: "s1", complete: true, reason: "disconnect" }, t.ops);
    assert.equal(t.updates[0]?.endReason, "COMPLETED");
  });

  it("quit after the interviewer already said goodbye is a normal completion", async () => {
    const t = voiceOps({ finished: true });
    await handleVoiceSave({ sessionId: "s1", complete: true, reason: "quit" }, t.ops);
    assert.equal(t.updates[0]?.endReason, "COMPLETED");
  });

  it("a repeat completion cannot overwrite an existing quit", async () => {
    const t = voiceOps({ status: "COMPLETED" });
    await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(t.updates.length, 0);
  });

  it("completionEndReason / isQuitEarly", () => {
    assert.equal(completionEndReason("quit", false), "QUIT");
    assert.equal(completionEndReason("quit", true), "COMPLETED");
    assert.equal(completionEndReason(undefined, false), "COMPLETED");
    assert.equal(isQuitEarly({ status: "COMPLETED", endReason: "QUIT" }), true);
    assert.equal(isQuitEarly({ status: "COMPLETED", endReason: "COMPLETED" }), false);
    assert.equal(isQuitEarly({ status: "ABANDONED", endReason: "QUIT" }), false);
    assert.equal(isQuitEarly(null), false);
  });

  it("quit link follows completed behaviour: consumed, not reusable, labelled Completed", () => {
    const quit = { status: "COMPLETED", endReason: "QUIT", interviewBeganAt: ago(HOUR) };
    assert.equal(isLinkConsumed(quit.status), true);
    assert.equal(canRestartFromLink(quit.status), false);
    assert.equal(inviteSessionAction(quit.status), "reuse");
    assert.equal(needsFreshInviteLink({ session: quit, nowMs: NOW }), false);
    assert.equal(formatSessionStatusLabel(quit, NOW), "Completed");
    assert.match(sessionStatusNote("COMPLETED", "QUIT") ?? "", /Quit early/);
    assert.equal(sessionStatusNote("COMPLETED", "COMPLETED"), null);
  });

  it("report generation runs for a quit session with whatever answers exist", () => {
    const s = { status: "COMPLETED" };
    assert.deepEqual(decideReport(s, { candidateWords: 12, assistantLines: 3, hasArtifacts: false }, NOW), { action: "generate" });
    assert.deepEqual(decideReport(s, { candidateWords: 0, assistantLines: 2, hasArtifacts: false }, NOW), { action: "generate" });
  });

  it("client quit reason rides on the final beacon body only", () => {
    const msgs = [{ id: "a", seq: 1 }, { id: "b", seq: 2 }];
    const bodies = beaconBodies("s1", msgs, true, 60, "quit").map((b) => JSON.parse(b));
    assert.ok(bodies.length > 1);
    assert.equal(bodies.at(-1).reason, "quit");
    assert.equal(bodies.at(-1).complete, true);
    for (const b of bodies.slice(0, -1)) assert.equal(b.reason, undefined);
    assert.equal(JSON.parse(beaconBodies("s1", msgs, true)[0]).reason, undefined);
  });
});
