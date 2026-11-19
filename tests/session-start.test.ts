import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HEARTBEAT_GRACE_MS,
  START_RETRY_WINDOW_MS,
  canRestartFromLink,
  decideStart,
  inviteSessionAction,
  startSessionWithRetry,
} from "@/lib/session-link";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("abandoned links are reusable, other links keep expiring", () => {
  it("restarts only an abandoned attempt", () => {
    assert.equal(canRestartFromLink("ABANDONED"), true);
    assert.equal(inviteSessionAction("ABANDONED"), "restart");
  });

  it("keeps completed / disqualified / running sessions as they are", () => {
    for (const s of ["COMPLETED", "DISQUALIFIED", "IN_PROGRESS"]) {
      assert.equal(canRestartFromLink(s), false);
      assert.equal(inviteSessionAction(s), "reuse");
    }
  });

  it("creates a session when none is linked", () => {
    assert.equal(inviteSessionAction(null), "create");
    assert.equal(inviteSessionAction(undefined), "create");
  });
});

describe("decideStart", () => {
  const began = { status: "IN_PROGRESS", interviewBeganAt: ago(30_000), lastHeartbeatAt: ago(2_000) };

  it("starts a session that has not begun", () => {
    assert.deepEqual(decideStart({ status: "IN_PROGRESS", interviewBeganAt: null }, { nowMs: NOW }), { action: "start" });
  });

  it("is idempotent for a same-tab retry while the heartbeat is fresh", () => {
    assert.deepEqual(decideStart(began, { retry: true, nowMs: NOW }), { action: "resume" });
  });

  it("refuses a fresh tab on a begun interview (one-time link)", () => {
    assert.deepEqual(decideStart(began, { nowMs: NOW }), { action: "expired", status: "IN_PROGRESS" });
  });

  it("refuses retries outside the retry window", () => {
    const old = { ...began, interviewBeganAt: ago(START_RETRY_WINDOW_MS + 1) };
    assert.equal(decideStart(old, { retry: true, nowMs: NOW }).action, "expired");
  });

  it("abandons a begun session whose heartbeat went stale", () => {
    const stale = { ...began, lastHeartbeatAt: ago(HEARTBEAT_GRACE_MS + 1) };
    assert.equal(decideStart(stale, { retry: true, nowMs: NOW }).action, "abandon_stale");
  });

  it("reports ended sessions as expired with their status", () => {
    for (const status of ["COMPLETED", "ABANDONED", "DISQUALIFIED"]) {
      assert.deepEqual(decideStart({ status, interviewBeganAt: ago(1_000) }, { retry: true, nowMs: NOW }), {
        action: "expired",
        status,
      });
    }
  });
});

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const sent: { retry: boolean }[] = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fn, sent };
}

const noSleep = async () => {};

describe("startSessionWithRetry", () => {
  it("retries network errors and 5xx, flagging later attempts as retries", async () => {
    const { fn, sent } = fakeFetch([new TypeError("fetch failed"), { status: 503, body: { error: "db" } }, { status: 200, body: { ok: true } }]);
    const r = await startSessionWithRetry("s1", { fetchFn: fn, sleep: noSleep });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(sent.map((b) => b.retry), [false, true, true]);
  });

  it("turns a nested rate-limit error into a string and honours Retry-After", async () => {
    const waits: number[] = [];
    const { fn } = fakeFetch([
      { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests." } }, headers: { "Retry-After": "3" } },
      { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests." } } },
    ]);
    const r = await startSessionWithRetry("s1", { fetchFn: fn, delaysMs: [1_000], sleep: async (ms) => void waits.push(ms) });
    assert.deepEqual(r, { ok: false, error: "Too many requests." });
    assert.deepEqual(waits, [3_000]);
  });

  it("stops on expired and passes the status through", async () => {
    const { fn, sent } = fakeFetch([{ status: 409, body: { ok: false, expired: true, status: "ABANDONED" } }]);
    const r = await startSessionWithRetry("s1", { fetchFn: fn, sleep: noSleep });
    assert.deepEqual(r, { ok: false, expired: true, status: "ABANDONED" });
    assert.equal(sent.length, 1);
  });

  it("does not retry other 4xx", async () => {
    const { fn, sent } = fakeFetch([{ status: 404, body: { error: "Not found" } }]);
    assert.deepEqual(await startSessionWithRetry("s1", { fetchFn: fn, sleep: noSleep }), { ok: false, error: "Not found" });
    assert.equal(sent.length, 1);
  });

  it("marks every call as a retry when the Retry button re-sends", async () => {
    const { fn, sent } = fakeFetch([{ status: 200, body: { ok: true, resumed: true } }]);
    assert.deepEqual(await startSessionWithRetry("s1", { fetchFn: fn, retry: true, sleep: noSleep }), { ok: true });
    assert.equal(sent[0].retry, true);
  });
});
