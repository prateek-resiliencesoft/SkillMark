import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleVoiceSave, type VoiceSaveOps } from "@/app/api/voice/save/logic";
import {
  MAX_REPORT_ATTEMPTS,
  REPORT_LOCK_STALE_MS,
  canMarkCompleted,
  contentStats,
  decideReport,
  hasReport,
  isLockHeld,
} from "@/lib/session-report-policy";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const answered = contentStats([
  { role: "ASSISTANT", content: "Tell me about yourself", contentType: "TEXT" },
  { role: "USER", content: "I build web apps with Next.js and Postgres", contentType: "TEXT" },
]);

describe("canMarkCompleted", () => {
  it("never re-completes or overrides a disqualification", () => {
    assert.equal(canMarkCompleted("COMPLETED"), false);
    assert.equal(canMarkCompleted("DISQUALIFIED"), false);
  });
  it("lets a late completion fix a false Abandoned", () => {
    assert.equal(canMarkCompleted("IN_PROGRESS"), true);
    assert.equal(canMarkCompleted("ABANDONED"), true);
  });
});

describe("hasReport", () => {
  it("counts a summary or a capture-failure notice", () => {
    assert.equal(hasReport({ summary: "ok", insights: null }), true);
    assert.equal(hasReport({ summary: null, insights: { captureFailure: { reason: "x" } } }), true);
    assert.equal(hasReport({ summary: "  ", insights: { keyInsights: [] } }), false);
  });
});

describe("decideReport", () => {
  it("generates for a completed session with answers", () => {
    assert.deepEqual(decideReport({ status: "COMPLETED" }, answered, NOW), { action: "generate" });
  });
  it("generates for a session that left early but answered something", () => {
    assert.deepEqual(decideReport({ status: "ABANDONED" }, answered, NOW), { action: "generate" });
  });
  it("skips live and disqualified sessions", () => {
    assert.equal(decideReport({ status: "IN_PROGRESS" }, answered, NOW).action, "skip");
    assert.equal(decideReport({ status: "DISQUALIFIED" }, answered, NOW).action, "skip");
  });
  it("skips when a report already exists (no double generation)", () => {
    assert.deepEqual(decideReport({ status: "COMPLETED", summary: "done" }, answered, NOW), {
      action: "skip",
      reason: "has_report",
    });
  });
  it("force regenerates an existing report", () => {
    assert.equal(decideReport({ status: "COMPLETED", summary: "old" }, answered, NOW, { force: true }).action, "generate");
  });
  it("skips while another worker holds a fresh lock, takes over a stale one", () => {
    const fresh = { status: "COMPLETED", reportStatus: "GENERATING", reportStartedAt: ago(30_000) };
    assert.deepEqual(decideReport(fresh, answered, NOW), { action: "skip", reason: "busy" });
    const stale = { ...fresh, reportStartedAt: ago(REPORT_LOCK_STALE_MS + 1) };
    assert.equal(isLockHeld(stale, NOW), false);
    assert.equal(decideReport(stale, answered, NOW).action, "generate");
  });
  it("gives up after the max automatic attempts", () => {
    const s = { status: "COMPLETED", reportStatus: "FAILED", reportAttempts: MAX_REPORT_ATTEMPTS };
    assert.deepEqual(decideReport(s, answered, NOW), { action: "skip", reason: "gave_up" });
    assert.equal(decideReport({ ...s, reportAttempts: 1 }, answered, NOW).action, "generate");
  });
  it("skips an early leave with no candidate answers", () => {
    const stats = contentStats([{ role: "ASSISTANT", content: "Welcome!", contentType: "TEXT" }]);
    assert.deepEqual(decideReport({ status: "ABANDONED" }, stats, NOW), { action: "skip", reason: "no_content" });
    assert.deepEqual(decideReport({ status: "COMPLETED" }, contentStats([]), NOW), {
      action: "skip",
      reason: "no_content",
    });
  });
  it("still runs (capture-failure check) when many questions got no captured answers", () => {
    const stats = contentStats([
      { role: "ASSISTANT", content: "Q1", contentType: "TEXT" },
      { role: "ASSISTANT", content: "Q2", contentType: "TEXT" },
      { role: "ASSISTANT", content: "Q3", contentType: "TEXT" },
    ]);
    assert.equal(decideReport({ status: "ABANDONED" }, stats, NOW).action, "generate");
    assert.equal(decideReport({ status: "COMPLETED" }, stats, NOW).action, "generate");
  });
  it("counts code / whiteboard work as content", () => {
    const stats = contentStats([{ role: "USER", content: "", contentType: "CODE" }]);
    assert.equal(decideReport({ status: "ABANDONED" }, stats, NOW).action, "generate");
  });
});

function makeOps(status: string) {
  const updates: Record<string, unknown>[] = [];
  const scheduled: { force: boolean }[] = [];
  let summaries = 0;
  const ops: VoiceSaveOps = {
    insertMessages: async () => undefined,
    loadSessionForCompletion: async () => ({
      status,
      startedAt: new Date(NOW - 600_000).toISOString(),
      interview: {
        title: "t",
        objective: null,
        language: "en",
        userId: "u",
        projectId: "p",
        assessmentCriteria: null,
        questions: [],
      },
    }),
    loadFirstMessageTimestamp: async () => null,
    loadSessionForProgress: async () => null,
    updateSession: async (_id, payload) => {
      updates.push(payload);
    },
    generateSummary: async () => {
      summaries++;
    },
    scheduleReport: (_id, opts) => {
      scheduled.push(opts);
    },
    log: { info: () => undefined, error: () => undefined },
    now: () => new Date(NOW),
  };
  return { ops, updates, scheduled, summaries: () => summaries };
}

describe("voice save completion", () => {
  it("completes an in-progress session and queues one report", async () => {
    const t = makeOps("IN_PROGRESS");
    const r = await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(r.status, 200);
    assert.equal(t.updates[0]?.status, "COMPLETED");
    assert.equal(t.updates[0]?.endReason, "COMPLETED");
    assert.deepEqual(t.scheduled, [{ force: false }]);
    assert.equal(t.summaries(), 0);
  });
  it("ignores a repeated completion (COMPLETED is terminal)", async () => {
    const t = makeOps("COMPLETED");
    await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(t.updates.length, 0);
    assert.equal(t.scheduled.length, 0);
  });
  it("never completes a disqualified session", async () => {
    const t = makeOps("DISQUALIFIED");
    await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(t.updates.length, 0);
  });
  it("turns a false Abandoned into Completed and regenerates the report", async () => {
    const t = makeOps("ABANDONED");
    await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(t.updates[0]?.status, "COMPLETED");
    assert.deepEqual(t.scheduled, [{ force: true }]);
  });
});

describe("dashboard live polling", async () => {
  const { livePollInterval, LIVE_POLL_MS } = await import("@/lib/live-poll");
  it("polls while a session is in progress or a report is pending", () => {
    assert.equal(livePollInterval([{ session: { status: "IN_PROGRESS" } }]), LIVE_POLL_MS);
    assert.equal(livePollInterval({ items: [{ status: "COMPLETED", reportStatus: "PENDING" }] }), LIVE_POLL_MS);
  });
  it("stops once everything has ended", () => {
    assert.equal(livePollInterval([{ status: "COMPLETED", reportStatus: "READY" }]), false);
    assert.equal(livePollInterval(undefined), false);
  });
});

describe("voice save completion response", () => {
  it("reports completed:true so the client can stop retrying", async () => {
    const t = makeOps("IN_PROGRESS");
    const r = await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(r.body.completed, true);
  });
  it("returns 404 (not a silent 200) when the session can't be loaded", async () => {
    const t = makeOps("IN_PROGRESS");
    t.ops.loadSessionForCompletion = async () => null;
    const r = await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(r.status, 404);
    assert.equal(r.body.completed, false);
  });
  it("a repeat completion is acknowledged as completed", async () => {
    const t = makeOps("COMPLETED");
    const r = await handleVoiceSave({ sessionId: "s1", complete: true }, t.ops);
    assert.equal(r.status, 200);
    assert.equal(r.body.completed, true);
  });
});
