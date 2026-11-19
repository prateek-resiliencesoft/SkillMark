import assert from "node:assert/strict";
import test from "node:test";

import { reportAccess } from "@/lib/report-access";
import { isReportStuck, REPORT_LOCK_STALE_MS, withReportTimeout } from "@/lib/session-report-policy";

test("reportAccess: org members with project access can generate, not only the creator", () => {
  assert.deepEqual(reportAccess({ userId: "u1", interviewOwnerId: "u1", orgRole: null, hasProjectAccess: false }), { ok: true });
  // The live bug: a teammate (not the creator) got 404 from /api/ai/summarize.
  assert.deepEqual(reportAccess({ userId: "u2", interviewOwnerId: "u1", orgRole: "MEMBER", hasProjectAccess: true }), { ok: true });
  assert.deepEqual(reportAccess({ userId: "u2", interviewOwnerId: "u1", orgRole: "ADMIN", hasProjectAccess: true }), { ok: true });
  assert.equal(reportAccess({ userId: "u2", interviewOwnerId: "u1", orgRole: "VIEWER", hasProjectAccess: true }).ok, false);
  assert.equal(reportAccess({ userId: "u2", interviewOwnerId: "u1", orgRole: null, hasProjectAccess: true }).ok, false);
  assert.equal(reportAccess({ userId: "u2", interviewOwnerId: "u1", orgRole: "MEMBER", hasProjectAccess: false }).ok, false);
});

test("isReportStuck: dead lock or never-picked-up PENDING stops the spinner", () => {
  const now = Date.parse("2026-11-19T06:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(isReportStuck({ reportStatus: "GENERATING", reportStartedAt: ago(60_000) }, now), false);
  assert.equal(isReportStuck({ reportStatus: "GENERATING", reportStartedAt: ago(REPORT_LOCK_STALE_MS + 1) }, now), true);
  assert.equal(isReportStuck({ reportStatus: "PENDING", completedAt: ago(60_000) }, now), false);
  assert.equal(isReportStuck({ reportStatus: "PENDING", completedAt: ago(16 * 60_000) }, now), true);
  assert.equal(isReportStuck({ reportStatus: "PENDING", completedAt: null }, now), false);
  assert.equal(isReportStuck({ reportStatus: "READY", reportStartedAt: ago(10 * REPORT_LOCK_STALE_MS) }, now), false);
});

test("withReportTimeout: a hanging run fails instead of holding the lock", async () => {
  assert.equal(await withReportTimeout(Promise.resolve("ok"), 1000), "ok");
  await assert.rejects(withReportTimeout(new Promise(() => {}), 20), /timed out/);
});
