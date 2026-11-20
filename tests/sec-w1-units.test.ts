/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { memDb } from "./sec-w1-db";
import { projectInterviewForCandidate, projectCandidateForInvite, redactSessionForCandidate } from "@/lib/session-redact";
import { errorLogToCsv, type SessionErrorEntry } from "@/lib/session-error-log";
import { MAX_SIGNALS_PER_TYPE, mergeIntegritySignals, type IntegritySignal } from "@/lib/integrity/signals";
import { svgDataUrlToPng, MAX_SVG_BYTES } from "@/lib/ai/convert-svg";

test("interview projection is an allowlist (no prompts, rubrics, invite lists, contacts)", () => {
  const iv = projectInterviewForCandidate({
    id: "i",
    title: "T",
    systemPrompt: "SECRET",
    invitedEmails: ["a@b.c"],
    notifyPhones: ["+100"],
    questions: [{ id: "q", text: "Q", rubric: "R", idealAnswer: "A" }],
  })!;
  assert.deepEqual(iv, { id: "i", title: "T", questions: [{ id: "q", text: "Q" }] });
  assert.deepEqual(projectInterviewForCandidate({ id: "i", questions: [{ id: "q" }] }, { includeQuestions: false })!.questions, []);
  assert.deepEqual(projectCandidateForInvite({ id: "c", name: "N", notes: "x", inviteToken: "t", cvProfile: {} }), { id: "c", name: "N" });
  assert.deepEqual(
    redactSessionForCandidate({ id: "s", status: "COMPLETED", language: "en", insights: { score: 9 }, messages: [] }),
    { id: "s", status: "COMPLETED", language: "en" },
  );
});

test("error-log CSV neutralises spreadsheet formulas", () => {
  const entry = (message: string): SessionErrorEntry =>
    ({ sessionId: "s", createdAt: "t", category: "client", severity: "error", source: "client", message }) as any;
  const csv = errorLogToCsv(["=HYPERLINK(\"http://x\")", "+1", "-2", "@SUM(A1)", " =1", "\t=1", "ok"].map(entry));
  for (const line of csv.split("\n").slice(1)) {
    assert.ok(!/(^|,)"?\s*[=+\-@\t]/.test(line), line);
  }
});

test("SVG rasterisation refuses oversized / non-image inputs", async () => {
  const big = "data:image/svg+xml;base64," + Buffer.alloc(MAX_SVG_BYTES + 10, "a").toString("base64");
  assert.equal(await svgDataUrlToPng(big), null);
  const huge = `<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"></svg>`;
  assert.equal(await svgDataUrlToPng("data:image/svg+xml;base64," + Buffer.from(huge).toString("base64")), null);
  assert.equal(await svgDataUrlToPng("data:text/html;base64,PGgxPg=="), null);
  const small = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>`;
  const png = await svgDataUrlToPng("data:image/svg+xml;base64," + Buffer.from(small).toString("base64"));
  assert.ok(png?.startsWith("data:image/png;base64,"));
});

test("integrity signal flood cannot evict earlier suspicious samples", () => {
  const suspicious: IntegritySignal[] = [{ type: "liveness", timestamp: 1, value: 0 }];
  let log = mergeIntegritySignals([], suspicious);
  for (let i = 0; i < 20; i++) {
    const batch = Array.from({ length: 50 }, (_, j) => ({ type: "liveness" as const, timestamp: 100 + i * 50 + j, value: 1 }));
    log = mergeIntegritySignals(log, batch);
  }
  assert.ok(log.some((s) => s.timestamp === 1 && s.value === 0));
  assert.ok(log.filter((s) => s.type === "liveness").length <= MAX_SIGNALS_PER_TYPE);
});

test("migration 40 appends strikes under a row lock and never touches ended sessions", () => {
  const sql = readFileSync(join(__dirname, "..", "db", "init", "41-atomic-strike-append.sql"), "utf8");
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /<> 'IN_PROGRESS'/);
  assert.match(sql, /"supersededAt" IS NOT NULL/);
});

test("completion WhatsApp: skipped without candidate activity and capped per interview", async () => {
  const { notifySessionCompleted } = await import("@/server/completion-notify");
  const idle = { id: "s-idle", interviewId: "iv", status: "COMPLETED", interviewBeganAt: null, completionNotifiedAt: null };
  const db = memDb({ sessions: [idle], messages: [] });
  await notifySessionCompleted(db as any, "s-idle");
  assert.equal(idle.completionNotifiedAt, null);
  assert.ok(!db.calls.some((c) => c.table === "interviews"));

  const now = new Date().toISOString();
  const recent = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, interviewId: "iv", completionNotifiedAt: now }));
  const active = { id: "s-act", interviewId: "iv", status: "COMPLETED", interviewBeganAt: now, completionNotifiedAt: null };
  const db2 = memDb({ sessions: [active, ...recent], messages: [] });
  await notifySessionCompleted(db2 as any, "s-act");
  assert.ok(!db2.calls.some((c) => c.table === "interviews"));
});
