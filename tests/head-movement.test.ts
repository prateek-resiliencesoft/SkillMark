import assert from "node:assert/strict";
import test from "node:test";
import {
  HeadMovementMonitor,
  applyAntiCheatingViolation,
  countStrikes,
  classifyFrame,
  headWarningMessage,
  matrixToYawPitch,
} from "../src/lib/head-movement";

test("classifyFrame", () => {
  assert.equal(classifyFrame([]), "no_face");
  assert.equal(classifyFrame([{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }]), "multiple_faces");
  assert.equal(classifyFrame([{ yaw: 10, pitch: 5 }]), "ok");
  assert.equal(classifyFrame([{ yaw: -45, pitch: 0 }]), "looking_away");
  assert.equal(classifyFrame([{ yaw: 0, pitch: 40 }]), "looking_away");
});

test("matrixToYawPitch identity and 45deg yaw", () => {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const a = matrixToYawPitch(id);
  assert.ok(Math.abs(a.yaw) < 1e-9 && Math.abs(a.pitch) < 1e-9);
  const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
  // rotation about Y, column-major
  const ry = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  assert.ok(Math.abs(Math.abs(matrixToYawPitch(ry).yaw) - 45) < 1e-6);
});

test("monitor requires ~2s hold, ignores brief glances", () => {
  const m = new HeadMovementMonitor();
  let t = 0;
  for (; t < 1800; t += 200) assert.equal(m.update("looking_away", t), null);
  assert.equal(m.update("ok", t), null); // looked back before 2s
  t += 200;
  const start = t;
  let fired: string | null = null;
  for (; t <= start + 2000; t += 200) fired = m.update("looking_away", t) ?? fired;
  assert.equal(fired, "looking_away");
});

test("monitor cooldown separates violations", () => {
  const m = new HeadMovementMonitor();
  const hits: number[] = [];
  for (let t = 0; t <= 20000; t += 200) if (m.update("looking_away", t)) hits.push(t);
  assert.deepEqual(hits, [1800, 7800, 13800, 19800]);
});

test("no_face needs 2.5s", () => {
  const m = new HeadMovementMonitor();
  let first = -1;
  for (let t = 0; t <= 4000 && first < 0; t += 200) if (m.update("no_face", t)) first = t;
  assert.equal(first, 2600);
});

test("shared 3-strike policy: any violation types count, 3rd disqualifies", () => {
  let log: unknown[] = [];
  const r1 = applyAntiCheatingViolation(log, { type: "head_movement", timestamp: 2 });
  assert.equal(r1.strikes, 1); assert.equal(r1.disqualify, false); log = r1.log;
  const r2 = applyAntiCheatingViolation(log, { type: "page_departure", timestamp: 3 });
  assert.equal(r2.strikes, 2); assert.equal(r2.disqualify, false); log = r2.log;
  const r3 = applyAntiCheatingViolation(log, { type: "head_movement", timestamp: 4 });
  assert.equal(r3.strikes, 3); assert.equal(r3.disqualify, true);
  assert.equal(r3.headViolations, 2);
  const last = r3.log.at(-1) as { type: string; detail: string };
  assert.equal(last.type, "disqualified");
  assert.match(last.detail, /Disqualified after 3/);
  assert.equal(countStrikes(r3.log), 3); // the "disqualified" marker is not a strike
  assert.equal(headWarningMessage(1), "Warning 1 of 2: please keep your face toward the screen");
  assert.equal(headWarningMessage(2), "Warning 2 of 2: please keep your face toward the screen");
});

test("non-strike log entries don't count", () => {
  const r = applyAntiCheatingViolation([{ type: "note", timestamp: 1 }], { type: "paste", timestamp: 2 });
  assert.equal(r.strikes, 1);
  assert.equal(r.disqualify, false);
});

test("brief ok flicker does not reset a look-away streak", () => {
  const m = new HeadMovementMonitor();
  let first = -1;
  for (let t = 0; t <= 4000 && first < 0; t += 200) {
    const st = t === 1000 ? "ok" : "looking_away"; // one-frame flicker
    if (m.update(st, t)) first = t;
  }
  assert.equal(first, 1800);
});

test("reset(until) suppresses violations during grace period", () => {
  const m = new HeadMovementMonitor();
  m.reset(3000);
  let first = -1;
  for (let t = 0; t <= 6000 && first < 0; t += 200) if (m.update("looking_away", t)) first = t;
  assert.equal(first, 3000);
});
