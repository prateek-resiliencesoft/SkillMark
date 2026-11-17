import assert from "node:assert/strict";
import test from "node:test";
import { AvSyncMonitor, pearson, type AvSample } from "../src/lib/integrity/av-sync";
import { classifyDeviceLabel } from "../src/lib/integrity/devices";
import { LivenessChallenge, pickLivenessSchedule } from "../src/lib/integrity/liveness";
import { ReadingPatternDetector } from "../src/lib/integrity/reading-pattern";
import {
  assessIntegrity,
  classifyInjectedMarker,
  latencySeverity,
  type IntegritySignal,
} from "../src/lib/integrity/signals";
import { applyAntiCheatingViolation, countStrikes } from "../src/lib/head-movement";
import { effectiveIntegrityConfig } from "../src/lib/integrity/config";

test("classifyDeviceLabel", () => {
  assert.equal(classifyDeviceLabel("video", "OBS Virtual Camera"), "virtual");
  assert.equal(classifyDeviceLabel("video", "Dummy video device (0x0000)"), "virtual");
  assert.equal(classifyDeviceLabel("audio", "CABLE Output (VB-Audio Virtual Cable)"), "virtual");
  assert.equal(classifyDeviceLabel("audio", "Monitor of Built-in Audio Analog Stereo"), "virtual");
  assert.equal(classifyDeviceLabel("audio", "Krisp Microphone"), "processing");
  assert.equal(classifyDeviceLabel("video", "NVIDIA Broadcast"), "processing");
  assert.equal(classifyDeviceLabel("video", "FaceTime HD Camera (Built-in)"), "physical");
  assert.equal(classifyDeviceLabel("audio", ""), "physical");
});

test("pearson", () => {
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), 0);
});

function feed(m: AvSyncMonitor, n: number, f: (i: number) => Partial<AvSample>, t0 = 0) {
  const outs = [];
  for (let i = 0; i < n; i++) {
    outs.push(m.update({ t: t0 + i * 200, rms: 0.002, jawOpen: 0.01, faces: 1, aiSpeaking: false, ...f(i) }));
  }
  return outs;
}

test("AvSyncMonitor flags sustained voice with closed mouth", () => {
  const m = new AvSyncMonitor();
  feed(m, 20, () => ({})); // settle noise floor
  const outs = feed(m, 30, () => ({ rms: 0.08, jawOpen: 0.01 }), 4000);
  assert.ok(outs.some((o) => o.offscreenVoiceMs && o.offscreenVoiceMs >= 5000));
});

test("AvSyncMonitor does not flag a speaking candidate", () => {
  const m = new AvSyncMonitor();
  feed(m, 20, () => ({}));
  const outs = feed(m, 60, (i) => ({ rms: 0.08, jawOpen: i % 2 ? 0.3 : 0.12 }), 4000);
  assert.ok(!outs.some((o) => o.offscreenVoiceMs));
});

test("AvSyncMonitor ignores AI speech and yields a segment on AI turn start", () => {
  const m = new AvSyncMonitor();
  feed(m, 20, () => ({}));
  const echo = feed(m, 40, () => ({ rms: 0.08, jawOpen: 0.01, aiSpeaking: true }), 4000);
  assert.ok(!echo.some((o) => o.offscreenVoiceMs));
  // Candidate answer: loudness follows the mouth.
  feed(m, 50, (i) => (i % 2 ? { rms: 0.09, jawOpen: 0.35 } : { rms: 0.03, jawOpen: 0.08 }), 12_000);
  const [turn] = feed(m, 1, () => ({ aiSpeaking: true }), 22_000);
  assert.ok(turn.segment);
  assert.ok(turn.segment!.correlation > 0.8);
});

test("ReadingPatternDetector: repeated drift + return sweeps", () => {
  const d = new ReadingPatternDetector();
  let t = 0;
  let fired: number | null = null;
  for (let line = 0; line < 4 && fired === null; line++) {
    for (let i = 0; i <= 8 && fired === null; i++) fired = d.update({ t: (t += 150), x: -0.4 + i * 0.1 }, true);
    if (fired === null) fired = d.update({ t: (t += 150), x: -0.4 }, true);
  }
  assert.ok(fired !== null && fired >= 3);
});

test("ReadingPatternDetector: scattered gaze or not speaking is ignored", () => {
  const d = new ReadingPatternDetector();
  let fired: number | null = null;
  for (let i = 0; i < 200; i++) fired ??= d.update({ t: i * 150, x: Math.sin(i * 1.7) * 0.5 }, true);
  assert.equal(fired, null);
  const quiet = new ReadingPatternDetector();
  let t = 0;
  for (let line = 0; line < 5; line++) {
    for (let i = 0; i <= 8; i++) fired ??= quiet.update({ t: (t += 150), x: -0.4 + i * 0.1 }, false);
    fired ??= quiet.update({ t: (t += 150), x: -0.4 }, false);
  }
  assert.equal(fired, null);
});

test("LivenessChallenge", () => {
  const turn = new LivenessChallenge("turn_head", 0);
  assert.equal(turn.update({ t: 100, faces: 1, yaw: 25, smile: 0 }), null);
  assert.equal(turn.update({ t: 600, faces: 1, yaw: 3, smile: 0 }), "pass");

  const cover = new LivenessChallenge("cover_face", 0);
  assert.equal(cover.update({ t: 100, faces: 0, yaw: null, smile: null }), null);
  assert.equal(cover.update({ t: 800, faces: 0, yaw: null, smile: null }), "pass");

  // Face swap keeps rendering a face over the hand → never passes.
  const swapped = new LivenessChallenge("cover_face", 0);
  let r: string | null = null;
  for (let t = 0; t <= 10_000 && !r; t += 200) r = swapped.update({ t, faces: 1, yaw: 0, smile: 0 });
  assert.equal(r, "fail");

  const smile = new LivenessChallenge("smile", 0);
  smile.update({ t: 100, faces: 1, yaw: 0, smile: 0.7 });
  assert.equal(smile.update({ t: 300, faces: 1, yaw: 0, smile: 0.8 }), "pass");
});

test("pickLivenessSchedule spacing and distinct kinds", () => {
  for (const seed of [0, 0.3, 0.6, 0.99]) {
    const s = pickLivenessSchedule(() => seed);
    assert.equal(s.length, 2);
    assert.notEqual(s[0].kind, s[1].kind);
    assert.ok(s[0].atMs >= 120_000);
    assert.ok(s[1].atMs - s[0].atMs >= 120_000);
  }
});

test("latencySeverity: uniform delay vs natural variation", () => {
  assert.ok(latencySeverity([3100, 3300, 3000, 3200, 3150]).severity >= 0.7);
  assert.equal(latencySeverity([800, 4000, 1500, 9000, 2200]).severity, 0);
  assert.equal(latencySeverity([3000, 3100]).severity, 0); // too few
  assert.equal(latencySeverity([400, 450, 420, 410]).severity, 0); // fast, outside band
});

test("classifyInjectedMarker", () => {
  assert.equal(classifyInjectedMarker("chrome-extension://abc/cluely-overlay.js"), 0.9);
  assert.equal(classifyInjectedMarker("grammarly-desktop-integration"), 0.1);
  assert.equal(classifyInjectedMarker("chrome-extension://xyz/content.js"), 0.4);
});

test("assessIntegrity needs two independent groups for review", () => {
  const t = 0;
  const one: IntegritySignal[] = [{ type: "virtual_camera", timestamp: t, detail: "OBS Virtual Camera" }];
  assert.notEqual(assessIntegrity(one).concern, "review");

  const benign: IntegritySignal[] = [{ type: "processing_device", timestamp: t, detail: "Krisp Microphone" }];
  assert.equal(assessIntegrity(benign).concern, "none");

  const two: IntegritySignal[] = [
    ...one,
    { type: "av_correlation", timestamp: t, value: 0.01 },
    { type: "av_correlation", timestamp: t, value: 0.02 },
  ];
  const a = assessIntegrity(two);
  assert.equal(a.concern, "review");
  assert.ok(a.score < 70);

  const viaStrike = assessIntegrity(one, [{ type: "offscreen_voice", timestamp: t }]);
  assert.equal(viaStrike.concern, "review");
});

test("repeated weak signals alone cannot reach review; counts and factors are reported", () => {
  const many: IntegritySignal[] = Array.from({ length: 20 }, (_, i) => ({ type: "reading_pattern" as const, timestamp: i, value: 3 }));
  const a = assessIntegrity(many);
  assert.notEqual(a.concern, "review");
  const conv = a.groups.find((g) => g.group === "conversation")!;
  assert.ok(conv.level < 0.5);
  assert.equal(conv.signalCount, 20);
  assert.equal(conv.factors[0].count, 20);
  assert.equal(conv.factors[0].confidence, 0.3);
  assert.equal(a.signalCounts.reading_pattern, 20);
  assert.equal(a.elevatedGroups, 0);
});

test("effectiveIntegrityConfig enforces anti-cheat → head → integrity → liveness", () => {
  const all = { antiCheatingEnabled: true, headMovementDetectionEnabled: true, integrityChecksEnabled: true, livenessChallengesEnabled: true };
  assert.deepEqual(effectiveIntegrityConfig(all), { headMovementDetectionEnabled: true, integrityChecksEnabled: true, livenessChallengesEnabled: true });
  assert.deepEqual(effectiveIntegrityConfig({ ...all, headMovementDetectionEnabled: false }), {
    headMovementDetectionEnabled: false, integrityChecksEnabled: false, livenessChallengesEnabled: false,
  });
  assert.deepEqual(effectiveIntegrityConfig({ ...all, integrityChecksEnabled: false }), {
    headMovementDetectionEnabled: true, integrityChecksEnabled: false, livenessChallengesEnabled: false,
  });
  assert.equal(effectiveIntegrityConfig({ ...all, antiCheatingEnabled: false }).livenessChallengesEnabled, false);
  assert.equal(effectiveIntegrityConfig(null).integrityChecksEnabled, false);
});

test("new warn-tier types count as strikes; signals never do", () => {
  const log = [
    { type: "offscreen_voice", timestamp: 1 },
    { type: "device_switch", timestamp: 2 },
    { type: "av_correlation", timestamp: 3 },
  ];
  assert.equal(countStrikes(log), 2);
  const r = applyAntiCheatingViolation(log, { type: "offscreen_voice", timestamp: 4 });
  assert.equal(r.disqualify, true);
});
