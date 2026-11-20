/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before } from "node:test";

import { appendViolationRpc, cookieJar, ctxAs, inRequest, memDb } from "./sec-w1-db";
import { MAX_STRIKES } from "@/lib/head-movement";
import { sessionCapabilityCookieName, signSessionCapability } from "@/lib/session-capability";

// Routers load after sec-w1-db registers the server-only stub.
let sessionRouter: typeof import("@/server/routers/session").sessionRouter;
let candidateRouter: typeof import("@/server/routers/candidate").candidateRouter;
before(async () => {
  sessionRouter = (await import("@/server/routers/session")).sessionRouter;
  candidateRouter = (await import("@/server/routers/candidate")).candidateRouter;
});

const ORG = randomUUID();
const ORG2 = randomUUID();
const PROJ = randomUUID();
const PROJ2 = randomUUID();
const IV = randomUUID();
const IV_INVITE = randomUUID();
const IV2 = randomUUID();
const Q1 = randomUUID();

let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

function interviewRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: PROJ,
    title: "Backend",
    publicSlug: id === IV ? "open-slug" : id === IV_INVITE ? "invite-slug" : "other",
    isActive: true,
    requireInvite: id === IV_INVITE,
    voiceEnabled: false,
    antiCheatingEnabled: true,
    headMovementDetectionEnabled: true,
    integrityChecksEnabled: true,
    systemPrompt: "SECRET SYSTEM PROMPT",
    invitedEmails: ["victim@example.com"],
    questions: [{ id: Q1, order: 0, text: "Tell me", type: "OPEN", rubric: "SECRET RUBRIC", idealAnswer: "SECRET" }],
    project: { organizationId: ORG },
    ...extra,
  };
}

function world(sessions: Record<string, unknown>[] = [], candidates: Record<string, unknown>[] = []) {
  const tables: Record<string, any[]> = {
    organizations: [{ id: ORG, status: "ACTIVE" }, { id: ORG2, status: "ACTIVE" }],
    organization_members: [
      { organizationId: ORG, userId: "owner", role: "OWNER" },
      { organizationId: ORG, userId: "viewer", role: "VIEWER" },
      { organizationId: ORG2, userId: "outsider", role: "OWNER" },
      { organizationId: ORG2, userId: "owner", role: "OWNER" },
    ],
    projects: [{ id: PROJ, organizationId: ORG }, { id: PROJ2, organizationId: ORG2 }],
    project_members: [],
    interviews: [interviewRow(IV), interviewRow(IV_INVITE), interviewRow(IV2, { projectId: PROJ2, project: { organizationId: ORG2 } })],
    questions: [{ id: Q1, interviewId: IV }],
    sessions: sessions.map((s) => ({ interview: interviewRow((s.interviewId as string) ?? IV), ...s })),
    messages: [],
    candidates,
  };
  const createSession = (a: any, t: Record<string, any[]>) => {
    const id = randomUUID();
    t.sessions.push({
      id,
      interviewId: a.p_interview_id ?? IV,
      status: "IN_PROGRESS",
      startedAt: new Date().toISOString(),
      capabilityRequired: false,
      interview: interviewRow(a.p_interview_id ?? IV),
    });
    return { data: { id }, error: null };
  };
  return memDb(tables, {
    create_interview_session: createSession,
    append_anti_cheating_violation: appendViolationRpc,
  });
}

function liveSession(extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    interviewId: IV,
    status: "IN_PROGRESS",
    startedAt: new Date().toISOString(),
    interviewBeganAt: null,
    capabilityRequired: true,
    antiCheatingLog: [],
    integritySignals: [],
    language: "en",
    ...extra,
  };
}

function jarFor(sessionId: string) {
  const jar = cookieJar();
  jar.set(sessionCapabilityCookieName(sessionId), signSessionCapability(sessionId));
  return jar;
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e.code, code, e.message);
    return true;
  });
}

test("create issues a session capability; the bare session UUID is not a credential", async () => {
  const db = world();
  const jar = cookieJar();
  const res = await inRequest(jar, () => sessionRouter.createCaller(ctxAs(db)).create({ interviewSlug: "open-slug" }), nextIp());
  assert.deepEqual(Object.keys(res), ["sessionId"]);
  const row = db.tables.sessions.find((s) => s.id === res.sessionId);
  assert.equal(row?.capabilityRequired, true);
  assert.ok(jar.get(sessionCapabilityCookieName(res.sessionId)));

  const ok = await inRequest(jar, () =>
    sessionRouter.createCaller(ctxAs(db)).sendMessage({ sessionId: res.sessionId, content: "hello" }),
  );
  assert.ok(ok.userMessage);

  await inRequest(cookieJar(), () =>
    rejects(sessionRouter.createCaller(ctxAs(db)).sendMessage({ sessionId: res.sessionId, content: "forged" }), "FORBIDDEN"),
  );
});

test("create rejects invite-only interviews uniformly (no invite-list oracle, no bypass)", async () => {
  const db = world([], [{ id: randomUUID(), interviewId: IV_INVITE, email: "victim@example.com" }]);
  const messages: string[] = [];
  for (const participantEmail of ["victim@example.com", "nobody@example.com", undefined]) {
    await inRequest(cookieJar(), async () => {
      await assert.rejects(
        sessionRouter.createCaller(ctxAs(db)).create({ interviewSlug: "invite-slug", participantEmail }),
        (e: any) => (assert.equal(e.code, "FORBIDDEN"), messages.push(e.message), true),
      );
    }, nextIp());
  }
  assert.equal(new Set(messages).size, 1);
  assert.equal(db.tables.sessions.length, 0);
  assert.ok(!db.calls.some((c) => c.table === "candidates"));
});

test("candidate writes are rejected once the session has ended, been disqualified or superseded", async () => {
  const completed = liveSession({ status: "COMPLETED", completedAt: new Date().toISOString() });
  const dq = liveSession({ status: "DISQUALIFIED", completedAt: new Date().toISOString() });
  const superseded = liveSession({ supersededAt: new Date().toISOString() });
  const archived = liveSession({ dataArchivedAt: new Date().toISOString() });
  const db = world([completed, dq, superseded, archived]);
  const cases: [any, string][] = [[completed, "BAD_REQUEST"], [dq, "FORBIDDEN"], [superseded, "BAD_REQUEST"], [archived, "BAD_REQUEST"]];
  for (const [s, code] of cases) {
    const caller = sessionRouter.createCaller(ctxAs(db));
    await inRequest(jarFor(s.id), async () => {
      await rejects(caller.sendMessage({ sessionId: s.id, content: "late answer" }), code);
      await rejects(caller.saveCode({ sessionId: s.id, snippetId: "a", snapshotData: "{}" }), code);
      await rejects(caller.saveWhiteboard({ sessionId: s.id, drawingId: "d", snapshotData: "{}" }), code);
      await rejects(caller.deleteCode({ sessionId: s.id, snippetId: "a" }), code);
      await rejects(caller.deleteWhiteboard({ sessionId: s.id, drawingId: "d" }), code);
      await rejects(caller.updateCurrentQuestion({ sessionId: s.id, questionId: Q1 }), code);
    });
  }
  assert.equal(db.tables.messages.length, 0);
});

test("complete on an ended session is a no-op (no re-stamp, no second notification)", async () => {
  const doneAt = "2026-01-01T00:00:00.000Z";
  const completed = liveSession({ status: "COMPLETED", completedAt: doneAt });
  const db = world([completed]);
  const res = await inRequest(jarFor(completed.id), () => sessionRouter.createCaller(ctxAs(db)).complete({ id: completed.id }));
  assert.deepEqual(res, { success: true });
  assert.equal(db.tables.sessions[0].completedAt, doneAt);
  assert.ok(!db.calls.some((c) => c.table === "sessions" && c.op === "update"));

  const live = liveSession();
  const db2 = world([live]);
  await inRequest(cookieJar(), () => rejects(sessionRouter.createCaller(ctxAs(db2)).complete({ id: live.id }), "FORBIDDEN"));
  assert.equal(db2.tables.sessions[0].status, "IN_PROGRESS");
});

test("strikes cannot retroactively disqualify a completed session", async () => {
  const completed = liveSession({ status: "COMPLETED", completedAt: new Date().toISOString() });
  const db = world([completed]);
  const caller = sessionRouter.createCaller(ctxAs(db));
  for (let i = 0; i < MAX_STRIKES + 1; i++) {
    const r = await inRequest(jarFor(completed.id), () =>
      caller.reportAntiCheatingViolation({ sessionId: completed.id, violation: { type: "tab_switch", timestamp: Date.now() } }),
    );
    assert.equal(r.disqualified, false);
  }
  assert.equal(db.tables.sessions[0].status, "COMPLETED");
  assert.deepEqual(db.tables.sessions[0].antiCheatingLog, []);
});

test("parallel strike reports are all counted and disqualify at the threshold", async () => {
  const s = liveSession();
  const db = world([s]);
  const caller = sessionRouter.createCaller(ctxAs(db));
  await inRequest(jarFor(s.id), () =>
    Promise.all(
      Array.from({ length: MAX_STRIKES }, (_, i) =>
        caller.reportAntiCheatingViolation({ sessionId: s.id, violation: { type: "tab_switch", timestamp: Date.now() + i } }),
      ),
    ),
  );
  const row = db.tables.sessions[0];
  assert.equal(row.status, "DISQUALIFIED");
  assert.equal(row.antiCheatingLog.filter((v: any) => v.type === "tab_switch").length, MAX_STRIKES);
});

test("violation evidence keeps only this session's own image keys", async () => {
  const s = liveSession();
  const db = world([s]);
  const own = `orgs/${ORG}/projects/${PROJ}/candidates/session-${s.id}/images/cam.jpg`;
  const foreign = `orgs/${ORG}/projects/${PROJ}/candidates/session-${randomUUID()}/images/cam.jpg`;
  const caller = sessionRouter.createCaller(ctxAs(db));
  await inRequest(jarFor(s.id), async () => {
    await caller.reportAntiCheatingViolation({
      sessionId: s.id,
      violation: {
        type: "paste",
        timestamp: 1,
        imagePath: foreign,
        imageUrl: `https://app.example/api/files/images/${foreign}`,
        screenImagePath: `orgs/${ORG}/projects/${PROJ}/candidates/session-${s.id}/images/../../x/images/a.jpg`,
      },
    });
    await caller.reportAntiCheatingViolation({
      sessionId: s.id,
      violation: { type: "paste", timestamp: 2, imagePath: own, imageUrl: `https://evil.example/${own}` },
    });
    await caller.reportAntiCheatingViolation({
      sessionId: s.id,
      violation: { type: "paste", timestamp: 3, imagePath: own, imageUrl: `https://evil.example/api/files/images/${own}?token=t` },
    });
  });
  const [first, second, third] = db.tables.sessions[0].antiCheatingLog;
  assert.equal(first.imagePath, undefined);
  assert.equal(first.imageUrl, undefined);
  assert.equal(first.screenImagePath, undefined);
  assert.equal(second.imagePath, own);
  assert.equal(second.imageUrl, undefined);
  assert.equal(third.imageUrl, `/api/files/images/${own}?token=t`);
});

test("getById: capability required, candidate view redacted, ended sessions minimal, reviewers need project access", async () => {
  const s = liveSession();
  const ended = liveSession({ status: "COMPLETED", completedAt: new Date().toISOString() });
  const db = world([{ ...s, messages: [{ id: "m1", role: "USER", content: "hi", internalScore: 9 }] }, ended]);

  await inRequest(cookieJar(), () => rejects(sessionRouter.createCaller(ctxAs(db)).getById({ id: s.id }), "FORBIDDEN"));
  await inRequest(cookieJar(), () =>
    rejects(sessionRouter.createCaller(ctxAs(db, "outsider")).getById({ id: s.id }), "FORBIDDEN"),
  );

  const view: any = await inRequest(jarFor(s.id), () => sessionRouter.createCaller(ctxAs(db)).getById({ id: s.id }));
  const text = JSON.stringify(view);
  for (const secret of ["SECRET SYSTEM PROMPT", "SECRET RUBRIC", "victim@example.com", "antiCheatingLog", "internalScore"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.equal(view.interview.questions[0].text, "Tell me");

  const minimal: any = await inRequest(jarFor(ended.id), () => sessionRouter.createCaller(ctxAs(db)).getById({ id: ended.id }));
  assert.deepEqual(Object.keys(minimal).sort(), ["id", "language", "status"]);

  const full: any = await inRequest(cookieJar(), () => sessionRouter.createCaller(ctxAs(db, "owner")).getById({ id: s.id }));
  assert.equal(full.interview.systemPrompt, "SECRET SYSTEM PROMPT");
});

test("sendMessage rejects an expired invite whose interview never began; enforces size caps", async () => {
  const s = liveSession();
  const db = world([s], [{ id: randomUUID(), sessionId: s.id, interviewId: IV, expiresAt: "2020-01-01T00:00:00.000Z" }]);
  await inRequest(jarFor(s.id), () =>
    rejects(sessionRouter.createCaller(ctxAs(db)).sendMessage({ sessionId: s.id, content: "hi" }), "BAD_REQUEST"),
  );
  assert.equal(db.tables.messages.length, 0);

  const live = liveSession();
  const db2 = world([live]);
  db2.tables.messages.push(
    ...Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, sessionId: live.id, contentType: "CODE", content: `s${i}` })),
  );
  const caller = sessionRouter.createCaller(ctxAs(db2));
  await inRequest(jarFor(live.id), async () => {
    await rejects(caller.sendMessage({ sessionId: live.id, content: "x".repeat(20_001) }), "BAD_REQUEST");
    await rejects(caller.saveCode({ sessionId: live.id, snippetId: "new", snapshotData: "{}" }), "BAD_REQUEST");
    await rejects(caller.saveCode({ sessionId: live.id, snippetId: "x".repeat(101), snapshotData: "{}" }), "BAD_REQUEST");
  });
  assert.equal(db2.tables.messages.length, 30);
});

test("saveRecording refuses foreign / traversal paths, drops foreign URLs and cleared media", async () => {
  const s = liveSession();
  const db = world([s]);
  const own = `orgs/${ORG}/projects/${PROJ}/candidates/session-${s.id}/images/1.jpg`;
  const caller = sessionRouter.createCaller(ctxAs(db));
  await inRequest(jarFor(s.id), async () => {
    const bad = [
      `orgs/${ORG}/projects/${PROJ}/candidates/session-${s.id}/recordings/../../shared/recordings/a.webm`,
      `orgs/${ORG}/projects/${PROJ}/candidates/jane-doe/recordings/a.webm`,
      `orgs/${ORG2}/projects/${PROJ2}/candidates/session-${s.id}/recordings/a.webm`,
      `https://app.example/api/files/recordings/orgs/${ORG}/projects/${PROJ}/candidates/other/recordings/a.webm`,
    ];
    for (const audioRecordingUrl of bad) {
      await rejects(caller.saveRecording({ sessionId: s.id, audioRecordingUrl }), "BAD_REQUEST");
    }
    await caller.saveRecording({
      sessionId: s.id,
      screenshots: [{ url: "https://evil.example/x.jpg", path: own, timestamp: "1", type: "camera" }],
    });
  });
  const row = db.tables.sessions[0];
  assert.equal(row.audioRecordingUrl, undefined);
  assert.deepEqual(row.screenshots, [{ url: "", path: own, timestamp: "1", type: "camera" }]);

  const cleared = liveSession({ status: "COMPLETED", completedAt: new Date().toISOString(), mediaClearedAt: new Date().toISOString() });
  const db2 = world([cleared]);
  await inRequest(jarFor(cleared.id), () =>
    rejects(
      sessionRouter.createCaller(ctxAs(db2)).saveRecording({
        sessionId: cleared.id,
        screenshots: [{ url: "", path: `orgs/${ORG}/projects/${PROJ}/candidates/session-${cleared.id}/images/1.jpg`, timestamp: "1", type: "camera" }],
      }),
      "NOT_FOUND",
    ),
  );
});

test("logClientError ignores long-ended sessions", async () => {
  const old = liveSession({ status: "COMPLETED", completedAt: "2020-01-01T00:00:00.000Z" });
  const db = world([old]);
  const r = await inRequest(jarFor(old.id), () =>
    sessionRouter.createCaller(ctxAs(db)).logClientError({ sessionId: old.id, category: "ai", message: "fake outage" }),
  );
  assert.deepEqual(r, { ok: false, limited: false });
});

test("VIEWER cannot mutate sessions (doubtful flag, media review, archive)", async () => {
  const s = liveSession({ status: "COMPLETED" });
  const db = world([s]);
  const caller = sessionRouter.createCaller(ctxAs(db, "viewer"));
  await rejects(caller.setDoubtful({ sessionId: s.id, doubtful: true, remark: "x" }), "FORBIDDEN");
  await rejects(caller.setMediaReview({ sessionId: s.id, action: "declined" }), "FORBIDDEN");
  await rejects(caller.archiveMany({ ids: [s.id] }), "FORBIDDEN");
  assert.equal(db.tables.sessions[0].integrityDoubtfulAt, undefined);
});

test("candidate.listAll ignores a projectId outside the selected organization", async () => {
  const db = world([], [{ id: randomUUID(), interviewId: IV2, name: "Other org candidate" }]);
  const res = await candidateRouter
    .createCaller(ctxAs(db, "owner"))
    .listAll({ organizationId: ORG, projectId: PROJ2 });
  assert.deepEqual(res, { candidates: [], walkInSessions: [] });
  assert.ok(!db.calls.some((c) => c.table === "candidates"));
});

test("candidate.getByToken returns only what the invite pages render and binds pre-begin sessions", async () => {
  const s = liveSession({ capabilityRequired: false });
  const token = "tok_" + randomUUID();
  const db = world([], [
    {
      id: randomUUID(),
      interviewId: IV,
      inviteToken: token,
      name: "Jane",
      email: "jane@example.com",
      notes: "PRIVATE RECRUITER NOTE",
      cvProfile: { salary: "SECRET" },
      sessionId: s.id,
      expiresAt: null,
      session: { ...s },
      interview: interviewRow(IV),
    },
  ]);
  db.tables.sessions.push({ ...s });
  const jar = cookieJar();
  const res: any = await inRequest(jar, () => candidateRouter.createCaller(ctxAs(db)).getByToken({ token }));
  const text = JSON.stringify(res);
  for (const secret of ["PRIVATE RECRUITER NOTE", "SECRET", token, "victim@example.com", "antiCheatingLog"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  assert.equal(res.name, "Jane");
  assert.equal(res.session.id, s.id);
  assert.equal(res.interview.questions[0].text, "Tell me");
  assert.ok(jar.get(sessionCapabilityCookieName(s.id)));
  assert.equal(db.tables.sessions[0].capabilityRequired, true);

  const begun = { ...s, interviewBeganAt: new Date().toISOString() };
  const db2 = world([], [{ id: randomUUID(), interviewId: IV, inviteToken: token, sessionId: s.id, session: begun, interview: interviewRow(IV) }]);
  const jar2 = cookieJar();
  await inRequest(jar2, () => candidateRouter.createCaller(ctxAs(db2)).getByToken({ token }));
  assert.equal(jar2.get(sessionCapabilityCookieName(s.id)), undefined);

  const db3 = world([], [{ id: randomUUID(), interviewId: IV, inviteToken: token, expiresAt: "2020-01-01T00:00:00.000Z", interview: interviewRow(IV) }]);
  const expired: any = await inRequest(cookieJar(), () => candidateRouter.createCaller(ctxAs(db3)).getByToken({ token }));
  assert.deepEqual(expired.interview.questions, []);
});
