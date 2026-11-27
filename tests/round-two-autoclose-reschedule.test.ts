/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  AUTO_CLOSE_DEFAULT_GRACE_S,
  autoCloseGraceMs,
  decidePresence,
  humanIdentities,
  type PresenceState,
} from "@/lib/round-two/auto-close";
import {
  canReschedule,
  defaultRescheduleInput,
  formatIst,
  isRoundExpired,
  isoToIstInput,
  istInputToIso,
  rescheduleMode,
} from "@/lib/round-two/reschedule";
import { FAKE_POSTGREST_URL, installFakePostgrest, type FakePostgrest } from "./sec-w4-fake-postgrest";

const read = (p: string) => readFileSync(p, "utf8");

describe("round 2 auto-close: grace and identities", () => {
  it("defaults to 30 s and is configurable", () => {
    assert.equal(AUTO_CLOSE_DEFAULT_GRACE_S, 30);
    assert.equal(autoCloseGraceMs(undefined), 30_000);
    assert.equal(autoCloseGraceMs(""), 30_000);
    assert.equal(autoCloseGraceMs("45"), 45_000);
    assert.equal(autoCloseGraceMs("abc"), 30_000);
    assert.equal(autoCloseGraceMs("1"), 5_000, "clamped up to 5 s");
    assert.equal(autoCloseGraceMs("999999"), 3_600_000, "clamped to 1 h");
  });
  it("can be switched off", () => {
    for (const v of ["0", "off", "false", "disabled", "-3"]) assert.equal(autoCloseGraceMs(v), null, v);
  });
  it("counts only the candidate and panel, never the transcriber or other bots", () => {
    assert.deepEqual(humanIdentities(["cand:r1", "user:u1", "agent:r1", "egress-abc", "recorder"]), ["cand:r1", "user:u1"]);
    assert.deepEqual(humanIdentities(["agent:r1"]), []);
  });
});

describe("round 2 auto-close: presence decisions", () => {
  const T0 = Date.parse("2026-11-27T10:00:00.000Z");
  const g = 30_000;
  const state = (seenAt: string | null, emptySince: string | null): PresenceState => ({ seenAt, emptySince });
  const iso = (ms: number) => new Date(ms).toISOString();

  it("never closes a round nobody ever joined", () => {
    assert.deepEqual(decidePresence({ humans: 0, state: state(null, null), now: T0 + 10 * g, graceMs: g }), { type: "none" });
  });
  it("records the first sighting", () => {
    const a = decidePresence({ humans: 2, state: state(null, null), now: T0, graceMs: g });
    assert.deepEqual(a, { type: "present", seenAt: iso(T0), clearEmpty: false });
    assert.deepEqual(decidePresence({ humans: 2, state: state(iso(T0), null), now: T0 + 5000, graceMs: g }), { type: "none" });
  });
  it("starts the timer when the room empties, waits, then closes after the grace", () => {
    const seen = iso(T0 - 60_000);
    const start = decidePresence({ humans: 0, state: state(seen, null), now: T0, graceMs: g });
    assert.deepEqual(start, { type: "start_empty", emptySince: iso(T0) });
    assert.deepEqual(decidePresence({ humans: 0, state: state(seen, iso(T0)), now: T0 + g - 1, graceMs: g }), { type: "none" });
    assert.deepEqual(decidePresence({ humans: 0, state: state(seen, iso(T0)), now: T0 + g, graceMs: g }), { type: "close", emptySince: iso(T0) });
  });
  it("a rejoin inside the grace clears the timer so it never closes", () => {
    const seen = iso(T0 - 60_000);
    const back = decidePresence({ humans: 1, state: state(seen, iso(T0)), now: T0 + 20_000, graceMs: g });
    assert.deepEqual(back, { type: "present", seenAt: seen, clearEmpty: true });
    // empties again later: the timer starts over from the new moment
    const again = decidePresence({ humans: 0, state: state(seen, null), now: T0 + 40_000, graceMs: g });
    assert.deepEqual(again, { type: "start_empty", emptySince: iso(T0 + 40_000) });
  });
  it("does nothing when auto-close is off, and heals a bad timestamp", () => {
    assert.deepEqual(decidePresence({ humans: 0, state: state(iso(T0), iso(T0)), now: T0 + 10 * g, graceMs: null }), { type: "none" });
    const bad = decidePresence({ humans: 0, state: state(iso(T0), "garbage"), now: T0, graceMs: g });
    assert.equal(bad.type, "start_empty");
  });
});

describe("round 2 reschedule rules", () => {
  it("which statuses offer which action", () => {
    for (const s of ["ended", "cancelled", "no_show"]) assert.equal(rescheduleMode(s), "new_attempt", s);
    for (const s of ["scheduled", "draft"]) assert.equal(rescheduleMode(s), "in_place", s);
    assert.equal(rescheduleMode("live"), null);
    assert.equal(canReschedule("live"), false);
    assert.equal(canReschedule("ended"), true);
  });
  it("detects an expired scheduled round", () => {
    const now = Date.parse("2026-11-27T10:00:00Z");
    assert.equal(isRoundExpired({ status: "scheduled", scheduledAt: "2026-11-27T08:00:00Z", durationMin: 45 }, now), true);
    assert.equal(isRoundExpired({ status: "scheduled", scheduledAt: "2026-11-27T09:30:00Z", durationMin: 45 }, now), false);
    assert.equal(isRoundExpired({ status: "ended", scheduledAt: "2026-11-27T08:00:00Z", durationMin: 45 }, now), false);
    assert.equal(isRoundExpired({ status: "scheduled", scheduledAt: null, durationMin: 45 }, now), false);
  });
  it("converts IST wall-clock input to UTC and back", () => {
    assert.equal(istInputToIso("2026-11-28T15:30"), "2026-11-28T10:00:00.000Z");
    assert.equal(isoToIstInput("2026-11-28T10:00:00.000Z"), "2026-11-28T15:30");
    assert.equal(isoToIstInput(istInputToIso("2026-12-31T23:45")!), "2026-12-31T23:45");
    assert.equal(istInputToIso(""), null);
    assert.equal(istInputToIso("tomorrow"), null);
    assert.equal(isoToIstInput(null), "");
  });
  it("formats and suggests times in IST", () => {
    assert.match(formatIst("2026-11-28T10:00:00.000Z"), /3:30\s?pm IST$/i);
    assert.equal(formatIst(null), "Not set");
    const now = Date.parse("2026-11-27T10:10:00Z"); // 15:40 IST
    assert.equal(defaultRescheduleInput(now), "2026-11-28T15:00");
  });
});

describe("round 2 auto-close: sweep against a fake database and LiveKit", () => {
  const ROUND = "11111111-1111-4111-8111-111111111111";
  const ROOM = `r2-${ROUND}`;
  let db: FakePostgrest;
  let restoreFetch: typeof fetch;
  let inRoom: string[] | "error";
  let deleted: string[];
  let reported: string[];
  let sweep: typeof import("@/server/round-two/autoclose").sweepRoundTwoPresence;
  const T0 = Date.parse("2026-11-27T10:00:00.000Z");
  const row = () => db.tables["public.round_two_interviews"][0];

  before(async () => {
    process.env.POSTGREST_URL = FAKE_POSTGREST_URL;
    process.env.AUTH_SECRET = "autoclose-test-secret-0123456789abcdef";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "devsecret-devsecret-devsecret-12345";
    process.env.LIVEKIT_URL = "ws://livekit.test";
    ({ sweepRoundTwoPresence: sweep } = await import("@/server/round-two/autoclose"));
  });

  beforeEach(() => {
    inRoom = [];
    deleted = [];
    reported = [];
    delete process.env.ROUND2_AUTO_CLOSE_GRACE_S;
    db = installFakePostgrest({
      "public.round_two_interviews": [
        { id: ROUND, status: "live", livekitRoom: ROOM, roomSeenAt: null, roomEmptySince: null, reportStatus: "none", endedAt: null },
      ],
    });
    restoreFetch = globalThis.fetch;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      if (url.origin === "http://livekit.test") {
        if (url.pathname.endsWith("/ListParticipants")) {
          if (inRoom === "error") return new Response(JSON.stringify({ code: "internal", msg: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
          return Response.json({ participants: inRoom.map((identity) => ({ identity })) });
        }
        if (url.pathname.endsWith("/DeleteRoom")) {
          deleted.push(ROOM);
          return Response.json({});
        }
      }
      return inner(input, init);
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = restoreFetch;
    db?.restore();
  });

  const run = (offsetMs: number) => sweep(T0 + offsetMs, { runReport: (id) => void reported.push(id) });

  it("ignores a live round nobody has entered yet", async () => {
    assert.deepEqual(await run(0), []);
    assert.deepEqual(await run(120_000), []);
    assert.equal(row().status, "live");
    assert.equal(row().roomSeenAt, null);
  });

  it("the transcriber alone does not keep the round open", async () => {
    inRoom = ["cand:x", "user:u1", `agent:${ROUND}`];
    await run(0);
    assert.ok(row().roomSeenAt, "first sighting stored");
    inRoom = [`agent:${ROUND}`];
    await run(10_000);
    assert.ok(row().roomEmptySince, "timer started");
    assert.equal(row().status, "live");
    const closed = await run(10_000 + 30_000);
    assert.deepEqual(closed, [ROUND]);
    assert.equal(row().status, "ended");
    assert.equal(row().reportStatus, "pending", "report chain is triggered like End round");
    assert.equal(row().endReason, "auto_empty");
    assert.ok(row().endedAt);
    assert.deepEqual(reported, [ROUND]);
    assert.deepEqual(deleted, [ROOM]);
  });

  it("a rejoin inside the grace keeps the round live", async () => {
    inRoom = ["cand:x"];
    await run(0);
    inRoom = [];
    await run(5_000);
    inRoom = ["user:u1"]; // panelist comes back after 20 s
    await run(25_000);
    assert.equal(row().roomEmptySince, null, "timer cleared");
    inRoom = [];
    assert.deepEqual(await run(40_000), [], "the old timer must not fire");
    assert.deepEqual(await run(60_000), [], "only 20 s since it emptied again");
    assert.equal(row().status, "live");
    assert.deepEqual(await run(70_000), [ROUND], "30 s after it emptied the second time");
  });

  it("is idempotent: a second sweep and a manual end do not double-run the report", async () => {
    inRoom = ["cand:x"];
    await run(0);
    inRoom = [];
    await run(1_000);
    await run(31_000);
    assert.deepEqual(reported, [ROUND]);
    assert.deepEqual(await run(90_000), [], "ended rounds are not touched again");
    assert.deepEqual(reported, [ROUND]);
  });

  it("never closes when LiveKit cannot be reached", async () => {
    inRoom = ["cand:x"];
    await run(0);
    inRoom = "error";
    await run(1_000);
    await run(100_000);
    assert.equal(row().status, "live");
    assert.equal(row().roomEmptySince, null, "an outage is not read as everyone left");
  });

  it("honours ROUND2_AUTO_CLOSE_GRACE_S and can be disabled", async () => {
    process.env.ROUND2_AUTO_CLOSE_GRACE_S = "60";
    inRoom = ["cand:x"];
    await run(0);
    inRoom = [];
    await run(1_000);
    assert.deepEqual(await run(40_000), []);
    assert.deepEqual(await run(61_000), [ROUND]);
    // disabled
    db.tables["public.round_two_interviews"][0] = { ...row(), status: "live", roomEmptySince: iso(T0), roomSeenAt: iso(T0) };
    process.env.ROUND2_AUTO_CLOSE_GRACE_S = "off";
    assert.deepEqual(await run(500_000), []);
    assert.equal(row().status, "live");
  });
});

function iso(ms: number) {
  return new Date(ms).toISOString();
}

describe("round 2 auto-close and reschedule: wiring", () => {
  it("migration 55 is idempotent and adds only what is needed", () => {
    const sql = read("db/init/55-round-two-autoclose-reschedule.sql");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "roomSeenAt"/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "roomEmptySince"/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "rescheduledFromId"/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS round_two_interviews_end_reason_check/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
    assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDELETE FROM\b|ADD COLUMN "/);
  });
  it("the presence check runs on a short timer and ends the round only if it is still live", () => {
    assert.match(read("src/lib/report-sweeper.ts"), /sweepRoundTwoPresence/);
    assert.match(read("src/lib/report-sweeper.ts"), /ROUND_TWO_PRESENCE_INTERVAL_MS = 10_000/);
    const src = read("src/server/round-two/autoclose.ts");
    assert.match(src, /\.eq\("status", "live"\)/);
    assert.match(src, /reportStatus: "pending"/);
    assert.match(src, /listRoomIdentitiesStrict/);
  });
  it("reschedule is manager-only, refuses a live round and blocks a second open attempt", () => {
    const src = read("src/server/routers/roundTwo.ts");
    const i = src.indexOf("reschedule: protectedProcedure");
    const body = src.slice(i, src.indexOf("retryReport: protectedProcedure"));
    assert.match(body, /assertCanManage\(access\)/);
    assert.match(body, /rescheduleMode\(old\.status\)/);
    assert.match(body, /CONFLICT/);
    assert.match(body, /rescheduledFromId: old\.id/);
    assert.match(body, /livekitRoom: `r2-\$\{id\}`/);
    assert.doesNotMatch(body, /\.delete\(/, "the earlier attempt is kept as history");
  });
  it("the Round 2 page and candidate details both offer the button", () => {
    assert.match(read("src/app/(dashboard)/round-two/[id]/page.tsx"), /RescheduleRoundTwoButton/);
    assert.match(read("src/components/candidates/round-details.tsx"), /RescheduleRoundTwoButton/);
  });
  it("emails can be dry-run for local testing", () => {
    assert.match(read("src/server/round-two/email.ts"), /ROUND2_EMAIL_DRY_RUN/);
  });
});

describe("round 2 reschedule mutation against a fake database", () => {
  const ORG = "0a000000-0000-4000-8000-000000000001";
  const PROJECT = "0b000000-0000-4000-8000-000000000001";
  const CAND = "0c000000-0000-4000-8000-000000000001";
  const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PANEL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const OLD = "22222222-2222-4222-8222-222222222222";
  let db: FakePostgrest;
  let router: (typeof import("@/server/routers/roundTwo"))["roundTwoRouter"];
  let supabaseAdmin: (typeof import("@/lib/supabase/admin"))["supabaseAdmin"];
  const future = () => new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
  const caller = (id: string, email: string) =>
    router.createCaller({ supabase: supabaseAdmin, user: { id, email, user_metadata: {} } } as never);
  const oldRow = (status: string, extra: Record<string, unknown> = {}) => ({
    id: OLD,
    organizationId: ORG,
    projectId: PROJECT,
    candidateId: CAND,
    sourceSessionId: null,
    hostUserId: HOST,
    title: "Round 2 · Backend",
    status,
    durationMin: 60,
    livekitRoom: `r2-${OLD}`,
    candidateTokenHash: "old-hash",
    questionPlan: [{ id: "q1", text: "Explain CAP", category: "technical" }],
    round1Context: { summary: "kept" },
    report: { overallScore: 7 },
    reportStatus: "ready",
    recordingUrl: "https://files.test/rec.webm",
    ...extra,
  });

  before(async () => {
    process.env.POSTGREST_URL = FAKE_POSTGREST_URL;
    process.env.AUTH_SECRET = "autoclose-test-secret-0123456789abcdef";
    process.env.ROUND2_EMAIL_DRY_RUN = "1";
    ({ roundTwoRouter: router } = await import("@/server/routers/roundTwo"));
    ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  });

  beforeEach(() => {
    db = installFakePostgrest({
      "public.round_two_interviews": [oldRow("ended", { endReason: "auto_empty" })],
      "public.round_two_participants": [
        { id: "p-host", roundTwoId: OLD, userId: HOST, email: "host@co.test", role: "host", status: "accepted" },
        { id: "p-1", roundTwoId: OLD, userId: PANEL, email: "panel@co.test", role: "interviewer", status: "accepted" },
        { id: "p-2", roundTwoId: OLD, userId: null, email: "watch@co.test", role: "observer", status: "invited" },
      ],
      "public.candidates": [{ id: CAND, name: "Asha", email: "asha@mail.test" }],
      "public.profiles": [{ id: HOST, name: "Hema Host" }],
    });
  });
  after(() => db?.restore());

  const rounds = () => db.tables["public.round_two_interviews"];
  const people = (roundId: string) => db.tables["public.round_two_participants"].filter((p) => p.roundTwoId === roundId);

  it("creates a fresh attempt for an auto-closed round and keeps the old one untouched", async () => {
    const before = JSON.stringify(rounds()[0]);
    const when = future();
    const res = await caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: when, note: "Network issue" });
    assert.equal(res.mode, "new_attempt");
    assert.notEqual(res.roundTwoId, OLD);
    assert.equal(rounds().length, 2);
    assert.equal(JSON.stringify(rounds().find((r) => r.id === OLD)), before, "old round, report and recording stay as history");

    const fresh = rounds().find((r) => r.id === res.roundTwoId)!;
    assert.equal(fresh.status, "scheduled");
    assert.equal(fresh.scheduledAt, when);
    assert.equal(fresh.rescheduledFromId, OLD);
    assert.equal(fresh.rescheduleNote, "Network issue");
    assert.equal(fresh.candidateId, CAND);
    assert.equal(fresh.durationMin, 60);
    assert.equal(fresh.livekitRoom, `r2-${fresh.id}`);
    assert.notEqual(fresh.livekitRoom, `r2-${OLD}`);
    assert.notEqual(fresh.candidateTokenHash, "old-hash");
    assert.deepEqual(fresh.questionPlan.map((q: any) => q.text), ["Explain CAP"]);
    assert.equal(fresh.report ?? null, null, "no report copied");
    assert.ok(res.candidateLink.includes("/r2/c/"));
    assert.equal(res.candidateDelivery.status, "skipped", "dry run: nothing is sent");
    assert.deepEqual(
      people(fresh.id).map((p) => `${p.email}:${p.role}`).sort(),
      ["host@co.test:host", "panel@co.test:interviewer", "watch@co.test:observer"],
    );
    assert.equal(res.invites.length, 2);
  });

  it("works for cancelled, no-show and failed-report rounds too", async () => {
    for (const [status, extra] of [["cancelled", {}], ["no_show", {}], ["ended", { reportStatus: "failed", report: null }]] as const) {
      db.tables["public.round_two_interviews"] = [oldRow(status, extra)];
      const res = await caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: future(), emailCandidate: false });
      assert.equal(res.mode, "new_attempt", status);
      assert.equal(rounds().length, 2, status);
    }
  });

  it("lets the panel be edited for the new attempt", async () => {
    const res = await caller(HOST, "host@co.test").reschedule({
      id: OLD,
      scheduledAt: future(),
      interviewers: [{ email: "new@co.test", role: "interviewer" }],
    });
    assert.deepEqual(people(res.roundTwoId).map((p) => p.email).sort(), ["host@co.test", "new@co.test"]);
  });

  it("refuses a second open attempt, a live round, a past time and non-managers", async () => {
    await caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: future() });
    await assert.rejects(caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: future() }), (e: any) => e.code === "CONFLICT");
    assert.equal(rounds().length, 2, "a double click does not create a third attempt");

    db.tables["public.round_two_interviews"] = [oldRow("live")];
    await assert.rejects(caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: future() }), (e: any) => e.code === "BAD_REQUEST");

    db.tables["public.round_two_interviews"] = [oldRow("ended")];
    await assert.rejects(
      caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: new Date(Date.now() - 3600_000).toISOString() }),
      (e: any) => e.code === "BAD_REQUEST",
    );
    await assert.rejects(caller(PANEL, "panel@co.test").reschedule({ id: OLD, scheduledAt: future() }), (e: any) => e.code === "FORBIDDEN");
    assert.equal(rounds().length, 1);
  });

  it("changes the time of a scheduled round in place with a new link, keeping the panel", async () => {
    db.tables["public.round_two_interviews"] = [oldRow("scheduled", { report: null, reportStatus: "none", scheduledAt: new Date(Date.now() - 7200_000).toISOString() })];
    const when = future();
    const res = await caller(HOST, "host@co.test").reschedule({ id: OLD, scheduledAt: when });
    assert.equal(res.mode, "in_place");
    assert.equal(res.roundTwoId, OLD);
    assert.equal(rounds().length, 1);
    assert.equal(rounds()[0].scheduledAt, when);
    assert.notEqual(rounds()[0].candidateTokenHash, "old-hash");
    const p1 = people(OLD).find((p) => p.id === "p-1")!;
    assert.equal(p1.status, "accepted", "an accepted panelist keeps access");
    assert.equal(p1.userId, PANEL);
  });
});
