import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRoundTabs,
  buildTimeline,
  defaultRound,
  latestRound2,
  latestRoundStatus,
  nextAction,
  parseRoundParam,
  resolveActiveRound,
  withRoundParam,
  type Round1Facts,
  type Round2Facts,
} from "@/lib/round-details";

const r1Done: Round1Facts = { status: "COMPLETED", score: 7.25, decision: "approved", hasSession: true };
const r2 = (over: Partial<Round2Facts> = {}): Round2Facts => ({
  id: "r2a",
  status: "scheduled",
  reportStatus: "none",
  scheduledAt: "2026-11-27T10:00:00Z",
  startedAt: null,
  endedAt: null,
  createdAt: "2026-11-26T10:00:00Z",
  overallScore: null,
  recommendation: null,
  ...over,
});

describe("round param", () => {
  it("accepts only 1 or 2", () => {
    assert.equal(parseRoundParam("1"), 1);
    assert.equal(parseRoundParam("2"), 2);
    for (const bad of ["3", "0", "", "abc", null, undefined]) assert.equal(parseRoundParam(bad as string | null), null);
  });

  it("sets and clears ?round= while keeping other params", () => {
    assert.equal(withRoundParam("?session=abc", 2), "?session=abc&round=2");
    assert.equal(withRoundParam("?session=abc&round=1", 2), "?session=abc&round=2");
    assert.equal(withRoundParam("?round=2", null), "");
    assert.equal(withRoundParam(new URLSearchParams("a=1&round=2"), null), "?a=1");
  });
});

describe("default round: latest in progress or completed", () => {
  it("is Round 1 when there is no Round 2", () => {
    assert.equal(defaultRound(null), 1);
  });
  it("is Round 2 once it is scheduled, live, ended or a no-show", () => {
    for (const status of ["scheduled", "live", "ended", "no_show"]) assert.equal(defaultRound(r2({ status })), 2, status);
  });
  it("stays on Round 1 for a draft or cancelled Round 2", () => {
    for (const status of ["draft", "cancelled"]) assert.equal(defaultRound(r2({ status })), 1, status);
  });
  it("opens the finished Round 2 (not the stale Round 1 result) after R1 pass then R2 done", () => {
    const done = r2({ status: "ended", reportStatus: "ready", overallScore: 8.2 });
    const tabs = buildRoundTabs(r1Done, done);
    assert.equal(resolveActiveRound(null, tabs, done), 2);
  });
});

describe("resolveActiveRound", () => {
  const live = r2({ status: "live" });
  const tabs = buildRoundTabs(r1Done, live);
  it("an explicit valid ?round= wins", () => {
    assert.equal(resolveActiveRound("1", tabs, live), 1);
    assert.equal(resolveActiveRound("2", tabs, live), 2);
  });
  it("?round=2 without a Round 2 falls back to Round 1", () => {
    assert.equal(resolveActiveRound("2", buildRoundTabs(r1Done, null), null), 1);
  });
  it("garbage falls back to the default", () => {
    assert.equal(resolveActiveRound("x", tabs, live), 2);
  });
});

describe("tabs", () => {
  it("shows only Round 1 until a Round 2 exists", () => {
    const tabs = buildRoundTabs(r1Done, null);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].status, "Completed");
    assert.equal(tabs[0].score, "7.3");
  });
  it("Round 2 badge follows its status and shows the score only when the report is ready", () => {
    const pending = buildRoundTabs(r1Done, r2({ status: "ended", reportStatus: "generating", overallScore: 9 }))[1];
    assert.equal(pending.status, "Report pending");
    assert.equal(pending.score, null);
    const ready = buildRoundTabs(r1Done, r2({ status: "ended", reportStatus: "ready", overallScore: 8.04 }))[1];
    assert.equal(ready.status, "Report ready");
    assert.equal(ready.score, "8.0");
    assert.equal(buildRoundTabs(r1Done, r2({ status: "live" }))[1].tone, "live");
  });
  it("Round 1 states", () => {
    const t = (status: string | null, hasSession = true) => buildRoundTabs({ status, score: null, decision: null, hasSession }, null)[0];
    assert.equal(t("IN_PROGRESS").status, "In progress");
    assert.equal(t("ABANDONED").status, "Left early");
    assert.equal(t("DISQUALIFIED").tone, "danger");
    assert.equal(t(null, false).status, "Not started");
  });
});

describe("latestRound2", () => {
  it("picks the newest attempt regardless of input order", () => {
    const a = r2({ id: "old", createdAt: "2026-11-01T00:00:00Z", status: "cancelled" });
    const b = r2({ id: "new", createdAt: "2026-11-20T00:00:00Z" });
    assert.equal(latestRound2([a, b])?.id, "new");
    assert.equal(latestRound2([b, a])?.id, "new");
    assert.equal(latestRound2([]), null);
    assert.equal(latestRound2(null), null);
  });
});

describe("next action and timeline", () => {
  it("walks the pipeline", () => {
    assert.equal(nextAction({ status: "COMPLETED", score: 6, decision: null, hasSession: true }, null).kind, "review_r1");
    assert.equal(nextAction(r1Done, null).kind, "schedule_r2");
    assert.equal(nextAction({ ...r1Done, decision: "rejected" }, null).kind, "none");
    assert.equal(nextAction(r1Done, r2({ status: "draft" })).kind, "finish_r2");
    assert.equal(nextAction(r1Done, r2()).kind, "open_r2");
    assert.equal(nextAction(r1Done, r2({ status: "live" })).kind, "join_r2");
    assert.equal(nextAction(r1Done, r2({ status: "ended", reportStatus: "pending" })).kind, "wait");
    assert.equal(nextAction(r1Done, r2({ status: "ended", reportStatus: "ready" })).kind, "review_r2");
    assert.equal(nextAction(r1Done, r2({ status: "no_show" })).kind, "reschedule_r2");
    assert.equal(nextAction({ status: null, score: null, decision: null, hasSession: false }, null).kind, "wait");
  });

  it("timeline marks progress", () => {
    const t = buildTimeline(r1Done, r2({ status: "ended", reportStatus: "ready", recommendation: "yes" }));
    assert.deepEqual(t.map((s) => s.key), ["r1", "decision", "r2", "report"]);
    assert.ok(t.every((s) => s.state === "done"));
    const mid = buildTimeline(r1Done, r2({ status: "live" }));
    assert.equal(mid.find((s) => s.key === "r2")?.state, "current");
    assert.equal(buildTimeline({ ...r1Done, decision: null }, null).length, 2);
    assert.equal(buildTimeline({ ...r1Done, decision: "rejected" }, null)[1].state, "failed");
  });
});

describe("list status (no stale Round 1)", () => {
  it("leads with Round 2 once it has started or finished", () => {
    assert.deepEqual(latestRoundStatus("Completed", { status: "scheduled" }), { round: 2, label: "Scheduled" });
    assert.deepEqual(latestRoundStatus("Completed", { status: "ended", reportStatus: "ready" }), { round: 2, label: "Report ready" });
  });
  it("keeps Round 1 for draft / cancelled / no Round 2", () => {
    assert.deepEqual(latestRoundStatus("Completed", { status: "draft" }), { round: 1, label: "Completed" });
    assert.deepEqual(latestRoundStatus("Completed", { status: "cancelled" }), { round: 1, label: "Completed" });
    assert.deepEqual(latestRoundStatus("Completed", null), { round: 1, label: "Completed" });
  });
});
