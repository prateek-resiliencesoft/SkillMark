/**
 * W2 recheck: /api/session/{complete,abandon,start,heartbeat,leave} require the
 * session capability cookie, refuse cross-site / non-JSON bodies, and never
 * resurrect or start superseded, never-started or expired sessions.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capCookie, installDb, iso, jsonPost, uuid } from "./sec-w2-db";
import { POST as complete } from "@/app/api/session/complete/route";
import { POST as abandon } from "@/app/api/session/abandon/route";
import { POST as start } from "@/app/api/session/start/route";
import { POST as heartbeat } from "@/app/api/session/heartbeat/route";
import { POST as leave } from "@/app/api/session/leave/route";
import { candidateWriteWindow, inviteExpiredForSession, LATE_WRITE_GRACE_MS } from "@/lib/session-link";
import { canMarkCompleted } from "@/lib/session-report-policy";
import { issueNewInviteLink } from "@/server/new-invite-link";

function session(over: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    interviewId: "iv-1",
    candidateId: null,
    status: "IN_PROGRESS",
    supersededAt: null,
    capabilityRequired: true,
    interviewBeganAt: iso(60_000),
    lastHeartbeatAt: iso(2_000),
    lastActivityAt: iso(2_000),
    completedAt: null,
    endReason: null,
    startedAt: iso(120_000),
    activitySegments: [{ enteredAt: iso(60_000), leftAt: null }],
    ...over,
  };
}

describe("lifecycle routes require the session capability", () => {
  const routes = { complete, abandon, start, heartbeat, leave } as const;
  for (const [name, handler] of Object.entries(routes)) {
    it(`${name}: bare session UUID is refused (403) and nothing is written`, async () => {
      const s = session();
      const db = installDb({ sessions: [s] });
      const res = await handler(jsonPost(`/api/session/${name}`, { sessionId: s.id }));
      assert.equal(res.status, 403);
      assert.equal(db.writes.length, 0);
      assert.equal(s.status, "IN_PROGRESS");
    });

    it(`${name}: cross-site and text/plain posts are refused`, async () => {
      const s = session();
      const db = installDb({ sessions: [s] });
      const cookie = capCookie(s.id);
      const evil = await handler(jsonPost(`/api/session/${name}`, { sessionId: s.id }, { cookie, headers: { origin: "https://evil.example" } }));
      assert.equal(evil.status, 403);
      const site = await handler(jsonPost(`/api/session/${name}`, { sessionId: s.id }, { cookie, headers: { "sec-fetch-site": "cross-site" } }));
      assert.equal(site.status, 403);
      const plain = await handler(jsonPost(`/api/session/${name}`, { sessionId: s.id }, { cookie, headers: { "content-type": "text/plain" } }));
      assert.equal(plain.status, 415);
      assert.equal(db.writes.length, 0);
    });
  }

  it("legacy rows (capabilityRequired=false) keep working without a cookie", async () => {
    const s = session({ capabilityRequired: false });
    installDb({ sessions: [s] });
    const res = await heartbeat(jsonPost("/api/session/heartbeat", { sessionId: s.id }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, expired: false });
  });

  it("same-origin sendBeacon-style request with the cookie is accepted", async () => {
    const s = session();
    installDb({ sessions: [s] });
    const res = await heartbeat(
      jsonPost("/api/session/heartbeat", { sessionId: s.id }, { cookie: capCookie(s.id), headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" } }),
    );
    assert.equal(res.status, 200);
  });
});

describe("complete never resurrects closed sessions", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["superseded abandoned attempt", { status: "ABANDONED", supersededAt: iso(5_000) }],
    ["never-started abandoned session", { status: "ABANDONED", interviewBeganAt: null, endReason: "NEVER_STARTED" }],
    ["long-abandoned session", { status: "ABANDONED", lastHeartbeatAt: iso(LATE_WRITE_GRACE_MS + 60_000), lastActivityAt: iso(LATE_WRITE_GRACE_MS + 60_000) }],
    ["NOT_STARTED session", { status: "NOT_STARTED", interviewBeganAt: null }],
    ["superseded pre-flight session", { status: "IN_PROGRESS", interviewBeganAt: null, supersededAt: iso(1_000) }],
  ];
  for (const [label, over] of cases) {
    it(`refuses ${label}`, async () => {
      const s = session(over);
      const db = installDb({ sessions: [s] });
      const res = await complete(jsonPost("/api/session/complete", { sessionId: s.id }, { cookie: capCookie(s.id) }));
      assert.ok(res.status === 409 || res.status === 200);
      assert.notEqual(s.status, "COMPLETED");
      assert.equal(db.writes.filter((w) => w.table === "sessions").length, 0);
    });
  }

  it("refuses an un-begun session whose invite expired", async () => {
    const candidateId = "cand-exp";
    const s = session({ candidateId, interviewBeganAt: null });
    installDb({ sessions: [s], candidates: [{ id: candidateId, sessionId: s.id, expiresAt: iso(60_000), inviteToken: "tok" }] });
    const res = await complete(jsonPost("/api/session/complete", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 409);
    assert.equal(s.status, "IN_PROGRESS");
  });
});

describe("leave ignores ended sessions", () => {
  it("does not touch a COMPLETED session's activity", async () => {
    const segs = [{ enteredAt: iso(60_000), leftAt: null }];
    const s = session({ status: "COMPLETED", completedAt: iso(30_000), activitySegments: segs });
    const db = installDb({ sessions: [s] });
    const res = await leave(jsonPost("/api/session/leave", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 200);
    assert.equal(db.writes.length, 0);
    assert.equal(segs[0].leftAt, null);
  });
});

describe("start refuses revoked / expired pre-flight sessions", () => {
  it("superseded pre-flight session (Send new link) cannot start", async () => {
    const candidateId = "cand-sup";
    const s = session({ candidateId, interviewBeganAt: null, supersededAt: iso(1_000) });
    installDb({ sessions: [s], candidates: [{ id: candidateId, sessionId: null, expiresAt: null, inviteToken: "new" }] });
    const res = await start(jsonPost("/api/session/start", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).expired, true);
    assert.equal(s.interviewBeganAt, null);
  });

  it("pre-flight session detached from its candidate cannot start", async () => {
    const candidateId = "cand-detached";
    const s = session({ candidateId, interviewBeganAt: null });
    installDb({ sessions: [s], candidates: [{ id: candidateId, sessionId: uuid(), expiresAt: null, inviteToken: "t" }] });
    const res = await start(jsonPost("/api/session/start", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 409);
    assert.equal(s.interviewBeganAt, null);
  });

  it("pre-flight session whose invite expired cannot start", async () => {
    const candidateId = "cand-expired";
    const s = session({ candidateId, interviewBeganAt: null });
    installDb({ sessions: [s], candidates: [{ id: candidateId, sessionId: s.id, expiresAt: iso(1_000), inviteToken: "t" }] });
    const res = await start(jsonPost("/api/session/start", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 409);
    assert.equal(s.interviewBeganAt, null);
  });

  it("a valid pre-flight session with its capability starts", async () => {
    const candidateId = "cand-ok";
    const s = session({ candidateId, interviewBeganAt: null });
    installDb({
      sessions: [s],
      candidates: [{ id: candidateId, sessionId: s.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), inviteToken: "t" }],
    });
    const res = await start(jsonPost("/api/session/start", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal(res.status, 200);
    assert.ok(s.interviewBeganAt);
  });

  it("heartbeat on a superseded session reports expired and writes nothing", async () => {
    const s = session({ supersededAt: iso(1_000) });
    const db = installDb({ sessions: [s] });
    const res = await heartbeat(jsonPost("/api/session/heartbeat", { sessionId: s.id }, { cookie: capCookie(s.id) }));
    assert.equal((await res.json()).expired, true);
    assert.equal(db.writes.length, 0);
  });
});

describe("Send new link closes the superseded pre-flight session", () => {
  it("marks an un-begun IN_PROGRESS session ABANDONED / NEVER_STARTED", async () => {
    const s = session({ interviewBeganAt: null, lastHeartbeatAt: null });
    const cand = { id: "cand-new-link", inviteToken: "old", expiresAt: iso(60_000), revokedInviteTokens: [], session: s };
    const db = installDb({ sessions: [s], candidates: [{ ...cand }] });
    await issueNewInviteLink(db as never, cand, "org-1", { email: false, whatsapp: false });
    assert.equal(s.status, "ABANDONED");
    assert.equal(s.endReason, "NEVER_STARTED");
    assert.ok(s.supersededAt);
  });
});

describe("pure window rules", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  const t = (ms: number) => new Date(now - ms).toISOString();
  it("NOT_STARTED can no longer be marked completed", () => {
    assert.equal(canMarkCompleted("NOT_STARTED"), false);
  });
  it("invite expiry only blocks interviews that had not begun before the deadline", () => {
    assert.equal(inviteExpiredForSession({ interviewBeganAt: null }, t(1), now), true);
    assert.equal(inviteExpiredForSession({ interviewBeganAt: t(10_000) }, t(1_000), now), false);
    assert.equal(inviteExpiredForSession({ interviewBeganAt: t(500) }, t(1_000), now), true);
  });
  it("only a recent, begun, non-superseded abandon is in the grace window", () => {
    const base = { status: "ABANDONED", interviewBeganAt: t(600_000), lastHeartbeatAt: t(5_000) };
    assert.equal(candidateWriteWindow(base, { nowMs: now }), "grace");
    assert.equal(candidateWriteWindow({ ...base, supersededAt: t(1) }, { nowMs: now }), "closed");
    assert.equal(candidateWriteWindow({ ...base, endReason: "NEVER_STARTED" }, { nowMs: now }), "closed");
    assert.equal(candidateWriteWindow({ ...base, lastHeartbeatAt: t(LATE_WRITE_GRACE_MS + 1) }, { nowMs: now }), "closed");
    assert.equal(candidateWriteWindow({ status: "DISQUALIFIED" }, { nowMs: now }), "closed");
  });
});
