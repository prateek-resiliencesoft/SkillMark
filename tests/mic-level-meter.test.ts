import assert from "node:assert/strict";
import test from "node:test";

import { LevelGuidance, type GuidanceInput, type GuidanceState, type MicState } from "@/lib/audio/level-guidance";
import {
  Ballistics,
  PeakHold,
  classifyLevel,
  classifyWithHysteresis,
  dbToFraction,
  formatDb,
  measureBuffer,
  rmsToDbfs,
} from "@/lib/audio/level-math";
import { LEVEL_CONFIG } from "@/lib/audio/level-thresholds";

const { floorDb } = LEVEL_CONFIG;

test("rmsToDbfs: silence / bad input -> finite floor, never NaN or Infinity", () => {
  for (const v of [0, -1, 1e-9, NaN, -Infinity]) {
    const db = rmsToDbfs(v);
    assert.equal(db, floorDb);
    assert.ok(Number.isFinite(db));
  }
  assert.ok(Number.isFinite(rmsToDbfs(Infinity)));
  assert.equal(formatDb(NaN), String(floorDb));
  assert.equal(Math.round(rmsToDbfs(1)), 0);
  assert.equal(Math.round(rmsToDbfs(0.5)), -6);
  assert.equal(Math.round(rmsToDbfs(0.1)), -20);
  assert.equal(measureBuffer(new Float32Array(0)).rms, 0);
  assert.equal(measureBuffer(new Float32Array([0.5, -0.5])).peak, 0.5);
});

test("classifyLevel: boundaries belong to the higher band", () => {
  assert.equal(classifyLevel(-90), "tooQuiet");
  assert.equal(classifyLevel(-45.01), "tooQuiet");
  assert.equal(classifyLevel(-45), "quiet");
  assert.equal(classifyLevel(-30.01), "quiet");
  assert.equal(classifyLevel(-30), "good");
  assert.equal(classifyLevel(-12.01), "good");
  assert.equal(classifyLevel(-12), "loud");
  assert.equal(classifyLevel(-6.01), "loud");
  assert.equal(classifyLevel(-6), "clipping");
  assert.equal(classifyLevel(0), "clipping");
  assert.equal(classifyLevel(NaN), "tooQuiet");
});

test("classifyWithHysteresis: needs a decisive crossing to change band", () => {
  assert.equal(classifyWithHysteresis("good", -31), "good"); // 1 dB below -30
  assert.equal(classifyWithHysteresis("good", -33), "quiet");
  assert.equal(classifyWithHysteresis("quiet", -29), "quiet");
  assert.equal(classifyWithHysteresis("quiet", -27), "good");
  assert.equal(classifyWithHysteresis(null, -29), "good");
});

test("dbToFraction maps the scale and clamps", () => {
  assert.equal(dbToFraction(0), 1);
  assert.equal(dbToFraction(-60), 0);
  assert.equal(dbToFraction(-30), 0.5);
  assert.equal(dbToFraction(-200), 0);
  assert.equal(dbToFraction(10), 1);
});

test("PeakHold holds ~1.5s then decays toward the live level", () => {
  const p = new PeakHold();
  assert.equal(p.update(-10, 0), -10);
  assert.equal(p.update(-40, 500), -10); // held
  assert.equal(p.update(-40, 1400), -10);
  const justAfter = p.update(-40, 1600);
  assert.ok(justAfter < -10 && justAfter > -40, "starts decaying once the hold expires");
  const later = p.update(-40, 2600);
  assert.ok(later < -10 && later > -40, `decaying: ${later}`);
  assert.equal(p.update(-40, 10_000), -40); // never below live level
  assert.equal(p.update(-5, 10_100), -5); // new max re-arms the hold
  assert.equal(p.update(-60, 11_000), -5);
});

test("Ballistics: fast attack, slower release, stays finite", () => {
  const b = new Ballistics();
  const up = b.update(-10, 50);
  assert.ok(up > floorDb + 40, "attack jumps most of the way within 50ms");
  const down = b.update(-60, 100);
  assert.ok(down < up && down > -60, "release is gradual");
  assert.ok(Number.isFinite(b.update(NaN, NaN)));
});

// ── guidance state machine ────────────────────────────────────────────────

const STEP = 50;
function drive(
  g: LevelGuidance,
  from: number,
  ms: number,
  level: (t: number) => number,
  opts: { expect?: boolean; micState?: MicState; peak?: (t: number) => number } = {},
) {
  let last!: GuidanceState;
  for (let t = from; t <= from + ms; t += STEP) {
    const db = level(t - from);
    const input: GuidanceInput = {
      now: t,
      micState: opts.micState ?? "live",
      db,
      peakDb: opts.peak ? opts.peak(t - from) : db,
      expectSpeaking: opts.expect ?? true,
    };
    last = g.update(input);
  }
  return last;
}
/** Speech-like: 700ms of `speech` dB then 300ms pause (room noise). */
const talk = (speech: number) => (t: number) => (t % 1000 < 700 ? speech : -70);

test("normal speech with pauses between sentences never warns", () => {
  const g = new LevelGuidance();
  let s = drive(g, 0, 10_000, talk(-20));
  assert.equal(s.warning, null);
  assert.equal(s.status, "good");
  // a long pause (silence) after speech is not a "too quiet" warning either
  s = drive(g, 10_100, 3_000, () => -75);
  assert.equal(s.warning, null);
});

test("quiet voice warns only after ~4s, with the quiet message", () => {
  const g = new LevelGuidance();
  const early = drive(g, 0, 3_000, talk(-40));
  assert.equal(early.warning, null);
  const late = drive(g, 3_050, 1_500, talk(-40));
  assert.equal(late.warning, "too-quiet");
  assert.equal(late.message, LEVEL_CONFIG.messages.tooQuiet);
  assert.equal(late.status, "quiet");
});

test("quiet warning clears after ~1s of healthy level", () => {
  const g = new LevelGuidance();
  drive(g, 0, 5_000, talk(-40));
  assert.equal(g.update({ now: 5_050, micState: "live", db: -40, peakDb: -40, expectSpeaking: true }).warning, "too-quiet");
  const mid = drive(g, 5_100, 150, () => -20);
  assert.equal(mid.warning, "too-quiet", "not cleared on a brief healthy blip");
  const after = drive(g, 5_300, 2_000, talk(-20));
  assert.equal(after.warning, null);
  assert.equal(after.status, "good");
});

test("no quiet warning while the AI talks / thinks (not the candidate's turn)", () => {
  const g = new LevelGuidance();
  const s = drive(g, 0, 8_000, talk(-40), { expect: false });
  assert.equal(s.warning, null);
  // and the window restarts when the candidate's turn begins
  const early = drive(g, 8_100, 2_000, talk(-40));
  assert.equal(early.warning, null);
});

test("near-total silence on the candidate's turn: no banner, only a subtle no-signal hint after a long time", () => {
  const g = new LevelGuidance();
  const short = drive(g, 0, 6_000, () => floorDb);
  assert.equal(short.warning, null);
  assert.equal(short.noSignal, false);
  const long = drive(g, 6_050, 6_000, () => floorDb);
  assert.equal(long.warning, null);
  assert.equal(long.noSignal, true);
});

test("sustained loud warns after ~1.5s, a single peak does not", () => {
  const g1 = new LevelGuidance();
  const single = drive(g1, 0, 5_000, (t) => (t === 2_000 ? -2 : -20), { peak: (t) => (t === 2_000 ? 0 : -20) });
  assert.equal(single.warning, null);

  const g2 = new LevelGuidance();
  const early = drive(g2, 0, 1_000, () => -4);
  assert.equal(early.warning, null);
  const loud = drive(g2, 1_050, 1_200, () => -4);
  assert.equal(loud.warning, "too-loud");
  assert.equal(loud.message, LEVEL_CONFIG.messages.tooLoud);
  const ok = drive(g2, 2_300, 1_500, talk(-20));
  assert.equal(ok.warning, null);
});

test("near-clip sample peaks count even when RMS is moderate", () => {
  const g = new LevelGuidance();
  const s = drive(g, 0, 3_000, () => -14, { peak: () => -0.1 });
  assert.equal(s.warning, "too-loud");
});

test("muted / disconnected / no-permission warn immediately and reset history", () => {
  const g = new LevelGuidance();
  drive(g, 0, 5_000, talk(-40));
  for (const [state, warning] of [
    ["muted", "muted"],
    ["disconnected", "disconnected"],
    ["no-permission", "no-permission"],
  ] as const) {
    const s = g.update({ now: 5_100, micState: state, db: floorDb, peakDb: floorDb, expectSpeaking: true });
    assert.equal(s.warning, warning);
    assert.equal(s.status, state);
    assert.equal(s.tone, "red");
    assert.ok(s.message);
  }
  // back live: fresh window, no stale quiet warning
  const back = g.update({ now: 5_200, micState: "live", db: -40, peakDb: -40, expectSpeaking: true });
  assert.equal(back.warning, null);
});

test("a long gap between frames (background tab) resets history", () => {
  const g = new LevelGuidance();
  drive(g, 0, 3_500, talk(-40));
  const s = drive(g, 60_000, 1_000, talk(-40));
  assert.equal(s.warning, null);
});
