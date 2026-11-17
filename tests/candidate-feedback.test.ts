/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedbackInput } from "../src/lib/candidate-feedback";
import {
  FeedbackError,
  feedbackForSession,
  feedbackStatus,
  listFeedback,
  submitFeedback,
  summarizeFeedback,
} from "../src/server/candidate-feedback";
import { fakeDb } from "./fake-db";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-11-16T12:00:00Z");

function world() {
  const tables: Record<string, any[]> = {
    sessions: [
      { id: S1, status: "COMPLETED", interviewId: "iv-a", startedAt: "2026-11-16T10:00:00Z" },
      { id: S2, status: "IN_PROGRESS", interviewId: "iv-a", startedAt: "2026-11-16T11:00:00Z" },
      { id: S3, status: "ABANDONED", interviewId: "iv-b", startedAt: "2026-10-01T10:00:00Z" },
    ],
    candidates: [
      { id: "c1", sessionId: S1, inviteToken: "tok-1", name: "Asha", email: "asha@example.com" },
      { id: "c3", sessionId: S3, inviteToken: "tok-3", name: "Ravi", email: "ravi@example.com" },
    ],
    interviews: [
      { id: "iv-a", projectId: "p-a", title: "Frontend" },
      { id: "iv-b", projectId: "p-b", title: "Backend" },
    ],
    projects: [
      { id: "p-a", organizationId: ORG_A },
      { id: "p-b", organizationId: ORG_B },
    ],
    organizations: [
      { id: ORG_A, name: "Alpha" },
      { id: ORG_B, name: "Beta" },
    ],
    candidate_feedback: [],
  };
  return { tables, db: fakeDb(tables) };
}

const input = (o: Record<string, unknown> = {}) => FeedbackInput.parse({ sessionId: S1, rating: 4, ...o });

test("feedback validation", () => {
  assert.equal(FeedbackInput.safeParse({ sessionId: S1, rating: 0 }).success, false);
  assert.equal(FeedbackInput.safeParse({ sessionId: S1, rating: 6 }).success, false);
  assert.equal(FeedbackInput.safeParse({ sessionId: S1, rating: 3.5 }).success, false);
  assert.equal(FeedbackInput.safeParse({ sessionId: "nope", rating: 3 }).success, false);
  assert.equal(FeedbackInput.safeParse({ sessionId: S1, rating: 3, tags: ["Made up"] }).success, false);
  assert.equal(FeedbackInput.safeParse({ sessionId: S1, rating: 3, comment: "x".repeat(1001) }).success, false);
  const ok = FeedbackInput.parse({ sessionId: S1, rating: 5, tags: ["Too long", "Too long"], comment: "  great  " });
  assert.deepEqual(ok.tags, ["Too long"]);
  assert.equal(ok.comment, "great");
  assert.equal(FeedbackInput.parse({ sessionId: S1, rating: 5, comment: "   " }).comment, null);
});

test("submit: stores org, candidate, interview; one per session", async () => {
  const { db, tables } = world();
  await submitFeedback(db, input({ tags: ["Audio quality"], comment: "Mic cut out once", inviteToken: "tok-1" }), { userAgent: "UA", nowMs: NOW });
  assert.equal(tables.candidate_feedback.length, 1);
  const row = tables.candidate_feedback[0];
  assert.equal(row.organizationId, ORG_A);
  assert.equal(row.candidateId, "c1");
  assert.equal(row.interviewId, "iv-a");
  assert.equal(row.rating, 4);
  assert.equal(row.userAgent, "UA");
  await assert.rejects(submitFeedback(db, input(), { nowMs: NOW }), (e: any) => e instanceof FeedbackError && e.code === "DUPLICATE" && e.status === 409);
  assert.equal(tables.candidate_feedback.length, 1);
  assert.deepEqual(await feedbackStatus(db, S1, undefined, NOW), { available: true, submitted: true });
});

test("submit: refuses live sessions, wrong token, unknown and old sessions", async () => {
  const { db } = world();
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: any) => e.code);
  assert.equal(await code(submitFeedback(db, input({ sessionId: S2 }), { nowMs: NOW })), "NOT_ENDED");
  assert.equal(await code(submitFeedback(db, input({ inviteToken: "someone-else" }), { nowMs: NOW })), "FORBIDDEN");
  assert.equal(await code(submitFeedback(db, input({ sessionId: "44444444-4444-4444-8444-444444444444" }), { nowMs: NOW })), "NOT_FOUND");
  assert.equal(await code(submitFeedback(db, input({ sessionId: S3 }), { nowMs: NOW })), "TOO_LATE");
  assert.deepEqual(await feedbackStatus(db, S2, undefined, NOW), { available: false, submitted: false });
});

test("missing table: form hidden, submit says unavailable, admin list empty", async () => {
  const { db } = world();
  const broken = {
    from(t: string) {
      if (t !== "candidate_feedback") return db.from(t);
      const err = { code: "42P01", message: 'relation "public.candidate_feedback" does not exist' };
      const b: any = new Proxy({}, { get: (_o, k) => (k === "then" ? (res: any) => res({ data: null, error: err }) : () => b) });
      return b;
    },
  };
  assert.deepEqual(await feedbackStatus(broken, S1, undefined, NOW), { available: false, submitted: false });
  await assert.rejects(submitFeedback(broken, input(), { nowMs: NOW }), (e: any) => e.code === "UNAVAILABLE" && e.status === 503);
  const list = await listFeedback(broken);
  assert.equal(list.available, false);
  assert.equal(list.rows.length, 0);
});

test("admin list: newest first, org filter isolates, names joined, summary", async () => {
  const { db, tables } = world();
  tables.candidate_feedback.push(
    { id: "f1", sessionId: S1, candidateId: "c1", organizationId: ORG_A, interviewId: "iv-a", rating: 5, tags: ["Questions were clear"], comment: "Smooth", createdAt: "2026-11-15T10:00:00Z" },
    { id: "f2", sessionId: S3, candidateId: "c3", organizationId: ORG_B, interviewId: "iv-b", rating: 2, tags: ["Technical issues", "Questions were clear"], comment: "Lag", createdAt: "2026-11-16T09:00:00Z" },
  );
  const all = await listFeedback(db);
  assert.deepEqual(all.rows.map((r) => r.id), ["f2", "f1"]);
  assert.equal(all.rows[0].organizationName, "Beta");
  assert.equal(all.rows[1].candidateName, "Asha");
  assert.equal(all.summary.total, 2);
  assert.equal(all.summary.average, 3.5);
  assert.deepEqual(all.summary.topTags[0], { tag: "Questions were clear", count: 2 });

  const onlyA = await listFeedback(db, { organizationId: ORG_A });
  assert.deepEqual(onlyA.rows.map((r) => r.organizationId), [ORG_A]);
  assert.equal(onlyA.summary.total, 1);
  assert.deepEqual((await listFeedback(db, { rating: 2 })).rows.map((r) => r.id), ["f2"]);
  assert.deepEqual((await listFeedback(db, { search: "asha" })).rows.map((r) => r.id), ["f1"]);
  assert.deepEqual((await listFeedback(db, { from: "2026-11-16T00:00:00Z" })).rows.map((r) => r.id), ["f2"]);

  // Org interviewers only see their own org's feedback.
  assert.equal((await feedbackForSession(db, S3, ORG_A)), null);
  assert.equal((await feedbackForSession(db, S3, ORG_B))?.rating, 2);
});

test("summary of no feedback", () => {
  const s = summarizeFeedback([]);
  assert.equal(s.total, 0);
  assert.equal(s.average, null);
  assert.equal(s.distribution.length, 5);
});
