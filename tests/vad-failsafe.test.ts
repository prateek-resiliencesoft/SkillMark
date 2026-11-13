import assert from "node:assert/strict";
import test from "node:test";

import { VadFailsafe, VAD_FAILSAFE_CONFIG } from "@/lib/voice/vad-failsafe";

const CHUNK_MS = 256; // ScriptProcessor 4096 samples @ 16kHz

/** Feed chunks; returns the first trigger and the time it fired. */
function feed(
  fs: VadFailsafe,
  start: number,
  rmsList: number[],
  opts: { aiSpeaking?: boolean; turnActive?: boolean; clientVad?: boolean; frames?: boolean } = {},
) {
  let t = start;
  for (const rms of rmsList) {
    if (opts.frames !== false) fs.vadFrame(t);
    const r = fs.micChunk(
      { now: t, rms, durationMs: CHUNK_MS, aiSpeaking: !!opts.aiSpeaking, turnActive: !!opts.turnActive },
      opts.clientVad ?? true,
    );
    if (r) return { reason: r, at: t };
    t += CHUNK_MS;
  }
  return { reason: null, at: t };
}

const quiet = (n: number) => Array(n).fill(0.001);
const speech = (n: number) => Array.from({ length: n }, (_, i) => (i % 5 === 4 ? 0.006 : 0.04));

test("Neeraj case: voice on the mic, Silero frames flowing but never opens a turn → falls back within ~1.5-2s", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(20)); // room tone while the AI asks
  const r = feed(fs, 20 * CHUNK_MS, speech(20));
  assert.equal(r.reason, "mic_voice_without_vad_turn");
  const elapsed = r.at - 20 * CHUNK_MS;
  assert.ok(elapsed >= VAD_FAILSAFE_CONFIG.sustainedVoiceMs - CHUNK_MS && elapsed <= 2_500, `fired after ${elapsed}ms`);
});

test("working Silero (turn open while speaking) never triggers", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(20));
  fs.turnOpened();
  const r = feed(fs, 20 * CHUNK_MS, speech(200), { turnActive: true });
  assert.equal(r.reason, null);
});

test("AI voice echo on the mic is ignored", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(10));
  const r = feed(fs, 10 * CHUNK_MS, speech(100), { aiSpeaking: true });
  assert.equal(r.reason, null);
});

test("steady background noise (fan) does not count as voice", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  const r = feed(fs, 0, Array(200).fill(0.02));
  assert.equal(r.reason, null);
});

test("short coughs / clicks below the sustained window don't trigger", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(20));
  // two 0.5s bursts separated by 3s of quiet
  let r = feed(fs, 20 * CHUNK_MS, [0.05, 0.05]);
  assert.equal(r.reason, null);
  r = feed(fs, 22 * CHUNK_MS, quiet(12));
  r = feed(fs, 34 * CHUNK_MS, [0.05, 0.05]);
  assert.equal(r.reason, null);
});

test("Silero producing no frames at all → vad_no_frames", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  const r = feed(fs, 0, quiet(30), { frames: false });
  assert.equal(r.reason, "vad_no_frames");
  assert.ok(r.at >= VAD_FAILSAFE_CONFIG.noFramesMs);
});

test("Silero frames stalling mid-session → vad_stalled", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(10));
  const r = feed(fs, 10 * CHUNK_MS, quiet(40), { frames: false });
  assert.equal(r.reason, "vad_stalled");
});

test("trips only once", () => {
  const fs = new VadFailsafe();
  fs.vadStarted(0);
  feed(fs, 0, quiet(20));
  assert.ok(feed(fs, 20 * CHUNK_MS, speech(20)).reason);
  assert.equal(feed(fs, 40 * CHUNK_MS, speech(40)).reason, null);
  assert.equal(fs.hasTripped, true);
});

test("with client VAD off it only collects per-question stats", () => {
  const fs = new VadFailsafe();
  feed(fs, 0, quiet(20), { clientVad: false });
  const r = feed(fs, 20 * CHUNK_MS, speech(20), { clientVad: false });
  assert.equal(r.reason, null);
  const q = fs.endQuestion();
  assert.ok(q.voicedMs >= 3_000);
  assert.equal(fs.questionMissed(q), true);
});

test("question safety net: voice but no transcript is flagged; with transcript it isn't", () => {
  const fs = new VadFailsafe();
  feed(fs, 0, quiet(20), { clientVad: false });
  feed(fs, 20 * CHUNK_MS, speech(20), { clientVad: false });
  fs.transcript(42);
  assert.equal(fs.questionMissed(fs.endQuestion()), false);
  feed(fs, 40 * CHUNK_MS, quiet(20), { clientVad: false });
  assert.equal(fs.questionMissed(fs.endQuestion()), false); // silent question → not flagged
});
