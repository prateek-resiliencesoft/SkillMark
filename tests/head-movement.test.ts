import assert from "node:assert/strict";
import test from "node:test";
import {
  HeadMovementMonitor,
  applyAntiCheatingViolation,
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
  assert.deepEqual(hits, [2000, 8000, 14000, 20000]);
});

test("no_face needs 3s", () => {
  const m = new HeadMovementMonitor();
  let first = -1;
  for (let t = 0; t <= 4000 && first < 0; t += 200) if (m.update("no_face", t)) first = t;
  assert.equal(first, 3000);
});

test("violation counter warns twice, disqualifies on 3rd head violation", () => {
  let log: unknown[] = [{ type: "paste", timestamp: 1 }];
  const r1 = applyAntiCheatingViolation(log, { type: "head_movement", timestamp: 2 });
  assert.equal(r1.headViolations, 1); assert.equal(r1.disqualify, false); log = r1.log;
  const r2 = applyAntiCheatingViolation(log, { type: "page_departure", timestamp: 3 });
  assert.equal(r2.disqualify, false); log = r2.log;
  const r3 = applyAntiCheatingViolation(log, { type: "head_movement", timestamp: 4 });
  assert.equal(r3.headViolations, 2); assert.equal(r3.disqualify, false); log = r3.log;
  const r4 = applyAntiCheatingViolation(log, { type: "head_movement", timestamp: 5 });
  assert.equal(r4.headViolations, 3); assert.equal(r4.disqualify, true);
  assert.equal(r4.log.length, 5);
  assert.equal(headWarningMessage(1), "Warning 1 of 2: please keep your face toward the screen");
  assert.equal(headWarningMessage(2), "Warning 2 of 2: please keep your face toward the screen");
});
