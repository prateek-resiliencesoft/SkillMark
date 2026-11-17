import assert from "node:assert/strict";
import test from "node:test";

import { handleVoiceSave, messageRowId, type VoiceSaveOps } from "@/app/api/voice/save/logic";
import { beaconBodies, newMessageId, unsentMessages } from "@/lib/transcript/outbox";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("newMessageId gives unique v4 uuids", () => {
  const ids = new Set(Array.from({ length: 200 }, newMessageId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, UUID);
});

test("unsentMessages merges in-flight and pending once each, in spoken order", () => {
  const a = { id: "a", seq: 1 };
  const b = { id: "b", seq: 2 };
  const c = { id: "c", seq: 3 };
  assert.deepEqual(unsentMessages([b, a], [a, c]).map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(unsentMessages([], []), []);
});

test("beaconBodies splits under the size cap and marks complete only on the last body", () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({ id: newMessageId(), seq: i, role: "user", content: "x".repeat(3000) }));
  const bodies = beaconBodies("s1", msgs, true, 20_000);
  assert.ok(bodies.length > 1);
  const parsed = bodies.map((b) => JSON.parse(b));
  for (const b of bodies) assert.ok(new TextEncoder().encode(b).length <= 20_000);
  assert.deepEqual(parsed.map((p) => !!p.complete), [...Array(bodies.length - 1).fill(false), true]);
  assert.deepEqual(parsed.flatMap((p) => p.messages.map((m: { id: string }) => m.id)), msgs.map((m) => m.id));
  assert.ok(parsed.every((p) => p.sessionId === "s1"));
  // Nothing to send: completion still goes out; plain flush sends nothing.
  assert.deepEqual(beaconBodies("s1", [], true).map((b) => JSON.parse(b)), [{ sessionId: "s1", messages: [], complete: true }]);
  assert.deepEqual(beaconBodies("s1", [], false), []);
});

test("messageRowId keeps a valid client uuid and replaces anything else", () => {
  const id = newMessageId();
  assert.equal(messageRowId(id, () => "fresh"), id);
  assert.equal(messageRowId(id.toUpperCase(), () => "fresh"), id);
  assert.equal(messageRowId("not-a-uuid", () => "fresh"), "fresh");
  assert.equal(messageRowId(undefined, () => "fresh"), "fresh");
});

/** Ops over an in-memory messages table keyed by id (same as the DB upsert with ignoreDuplicates). */
function store(opts: { failInsert?: boolean; status?: string } = {}) {
  const rows = new Map<string, { content: string }>();
  const updates: Record<string, unknown>[] = [];
  const reports: string[] = [];
  let status = opts.status ?? "IN_PROGRESS";
  const ops: VoiceSaveOps = {
    async insertMessages(_sessionId, messages) {
      if (opts.failInsert) throw new Error("insert failed");
      for (const m of messages) {
        const id = messageRowId(m.id, newMessageId);
        if (!rows.has(id)) rows.set(id, { content: m.content });
      }
    },
    async loadSessionForCompletion() {
      return { status, startedAt: "2026-11-16T10:00:00.000Z", interview: { title: "", objective: "", language: "en", userId: "u", projectId: "p", assessmentCriteria: [], questions: [] } };
    },
    async loadFirstMessageTimestamp() {
      return null;
    },
    async loadSessionForProgress() {
      return { interview: { questions: [] } };
    },
    async updateSession(_id, payload) {
      updates.push(payload);
      if (typeof payload.status === "string") status = payload.status;
    },
    async generateSummary() {},
    scheduleReport(id) {
      reports.push(id);
    },
    log: { info() {}, error() {} },
    now: () => new Date("2026-11-16T10:30:00.000Z"),
  };
  return { ops, rows, updates, reports };
}

test("resending the same lines (retry + tab-close beacon) stores them once", async () => {
  const { ops, rows, reports } = store();
  const lines = [
    { id: newMessageId(), role: "assistant", content: "Tell me about your last project.", seq: 1 },
    { id: newMessageId(), role: "user", content: "I built a payments dashboard in React.", seq: 2 },
  ];
  const progress = await handleVoiceSave({ sessionId: "s1", messages: lines }, ops);
  assert.equal(progress.status, 200);
  // Ack lost, tab closes: the beacon resends both lines plus one new one, with complete.
  const extra = { id: newMessageId(), role: "assistant", content: "Thanks, that is all.", seq: 3 };
  const beacon = await handleVoiceSave({ sessionId: "s1", messages: [...lines, extra], complete: true }, ops);
  assert.equal(beacon.status, 200);
  assert.equal(rows.size, 3);
  // The in-page final save arrives too: still 3 rows, completion not repeated.
  const again = await handleVoiceSave({ sessionId: "s1", messages: [...lines, extra], complete: true }, ops);
  assert.equal(again.status, 200);
  assert.equal(rows.size, 3);
  assert.deepEqual(reports, ["s1"]);
});

test("a failed insert is reported (not 200) so the client keeps and resends the lines", async () => {
  const { ops, updates } = store({ failInsert: true });
  const res = await handleVoiceSave({ sessionId: "s1", messages: [{ id: newMessageId(), role: "user", content: "hello", seq: 1 }] , currentQuestionIndex: 0 }, ops);
  assert.equal(res.status, 500);
  assert.equal(updates.length, 0);
});

test("a failed insert during completion still completes the session and starts the report", async () => {
  const { ops, updates, reports } = store({ failInsert: true });
  const res = await handleVoiceSave({ sessionId: "s1", messages: [{ id: newMessageId(), role: "user", content: "bye", seq: 1 }], complete: true }, ops);
  assert.equal(res.status, 500);
  assert.equal(res.body.completed, true);
  assert.equal(updates[0]?.status, "COMPLETED");
  assert.deepEqual(reports, ["s1"]);
});
