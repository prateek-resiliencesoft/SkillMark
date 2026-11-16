import assert from "node:assert/strict";
import test from "node:test";

import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";
import { BargeInDetector, SILERO_FRAME_MS, SilenceCheck, SILENCE_PROMPTS, stuckTurnReason, hasRecentVoiceEnergy } from "@/lib/voice/turn-guard";
import { absoluteAssetBase, vadProcessorOrder } from "@/lib/voice/silero-vad-client";
import { nextJitterTargetMs, JITTER_BUFFER_ADAPTIVE_MAX_MS, JITTER_BUFFER_TARGET_MS } from "@/lib/voice/playback-jitter-buffer";
import { pcm16Rms, silencePromptCue, silencePromptStage, noAnswerAdvanceCue } from "@/lib/voice/relay-keepalive";

const LOUD = 0.05;
const framesFor = (ms: number) => Math.ceil(ms / SILERO_FRAME_MS);

// ── Barge-in ───────────────────────────────────────────────────────
test("barge-in: short confident blip (<400ms) does not cut the AI", () => {
  const d = new BargeInDetector();
  let fired = false;
  for (let i = 0; i < framesFor(250); i++) fired ||= d.feed(0.95, LOUD);
  for (let i = 0; i < 5; i++) fired ||= d.feed(0.1, LOUD);
  assert.equal(fired, false);
  assert.equal(d.sustainedMs, 0);
});

test("barge-in: sustained confident speech (~400ms) cuts the AI", () => {
  const d = new BargeInDetector();
  let firedAt = -1;
  for (let i = 0; i < 30; i++) {
    if (d.feed(0.95, LOUD)) { firedAt = i + 1; break; }
  }
  assert.equal(firedAt, framesFor(ENDPOINTING_CONFIG.bargeInMinSpeechMs));
});

test("barge-in: quiet echo (low mic level) never cuts the AI, even if Silero is confident", () => {
  const d = new BargeInDetector();
  let fired = false;
  for (let i = 0; i < 100; i++) fired ||= d.feed(0.99, 0.003);
  assert.equal(fired, false);
});

test("barge-in: a couple of dip frames inside real speech are tolerated", () => {
  const d = new BargeInDetector();
  let fired = false;
  for (let i = 0; i < 6; i++) fired ||= d.feed(0.95, LOUD);
  fired ||= d.feed(0.5, LOUD);
  fired ||= d.feed(0.5, LOUD);
  for (let i = 0; i < 8 && !fired; i++) fired = d.feed(0.95, LOUD);
  assert.equal(fired, true);
});

test("barge-in: below the probability threshold never counts", () => {
  const d = new BargeInDetector();
  let fired = false;
  for (let i = 0; i < 100; i++) fired ||= d.feed(ENDPOINTING_CONFIG.bargeInSpeechThreshold - 0.05, LOUD);
  assert.equal(fired, false);
});

// ── Stuck turn ─────────────────────────────────────────────────────
test("stuck turn: open turn with no voice for 8s is closed", () => {
  assert.equal(stuckTurnReason({ now: 9_000, turnOpenedAt: 0, lastVoiceAt: 500, endpointPending: false }), "no_voice");
  assert.equal(stuckTurnReason({ now: 5_000, turnOpenedAt: 0, lastVoiceAt: 500, endpointPending: false }), null);
});

test("stuck turn: normal end-of-turn countdown running → leave it alone (until the hard cap)", () => {
  assert.equal(stuckTurnReason({ now: 20_000, turnOpenedAt: 0, lastVoiceAt: 0, endpointPending: true }), null);
  assert.equal(
    stuckTurnReason({ now: ENDPOINTING_CONFIG.maxTurnMs, turnOpenedAt: 0, lastVoiceAt: ENDPOINTING_CONFIG.maxTurnMs, endpointPending: true }),
    "max_turn_length",
  );
});

test("stuck turn: Ankit's case — a turn open for 9 minutes is always closed", () => {
  assert.equal(stuckTurnReason({ now: 9 * 60_000, turnOpenedAt: 0, lastVoiceAt: 9 * 60_000 - 100, endpointPending: false }), "max_turn_length");
});

// ── Silence reminders ──────────────────────────────────────────────
const idle = { turnActive: false, aiBusy: false, speechInProgress: false };
const C = ENDPOINTING_CONFIG;

test("silence config: 9s first reminder (8–10s), 5s gaps, 8s final wait, next_question policy", () => {
  assert.equal(C.silenceFirstPromptMs, 9_000);
  assert.ok(C.silenceFirstPromptMs >= 8_000 && C.silenceFirstPromptMs <= 10_000);
  assert.equal(C.silencePromptGapMs, 5_000);
  assert.equal(C.silenceFinalWaitMs, 8_000);
  assert.equal(C.silencePolicy, "next_question");
});

test("silence: stage 1 → 2 → 3 → skip, each wait timed from the end of the reminder's playback", () => {
  const c = new SilenceCheck();
  c.aiFinished(0); // question playback ended
  assert.equal(c.tick(8_999, idle), null);
  assert.deepEqual(c.tick(9_000, idle), { type: "prompt", stage: 1, text: "Are you there? Can you hear me?" });
  c.aiStarted(); // reminder 1 plays
  assert.equal(c.tick(12_000, idle), null);
  c.aiFinished(11_000);
  assert.equal(c.tick(15_999, idle), null);
  assert.deepEqual(c.tick(16_000, idle), { type: "prompt", stage: 2, text: "I can't hear your response. Are you still connected?" });
  c.aiStarted();
  c.aiFinished(18_000);
  assert.equal(c.tick(22_999, idle), null);
  assert.deepEqual(c.tick(23_000, idle), { type: "prompt", stage: 3, text: "It seems you've gone silent. I'll wait a little longer." });
  c.aiStarted();
  c.aiFinished(25_000);
  assert.equal(c.tick(32_999, idle), null);
  assert.deepEqual(c.tick(33_000, idle), { type: "skip", policy: "next_question" });
  // Only once per question; never anything after the skip.
  assert.equal(c.tick(99_000, idle), null);
});

test("silence: the reminder lines are verbatim and come from one shared list", () => {
  assert.deepEqual([...SILENCE_PROMPTS], [
    "Are you there? Can you hear me?",
    "I can't hear your response. Are you still connected?",
    "It seems you've gone silent. I'll wait a little longer.",
  ]);
  for (const stage of [1, 2, 3]) {
    const cue = silencePromptCue(stage);
    assert.match(cue, /^\[SILENCE_PROMPT\]/);
    assert.ok(cue.includes(`"${SILENCE_PROMPTS[stage - 1]}"`));
    assert.match(cue, /do not call any function/);
  }
  assert.equal(silencePromptStage("9"), 3);
  assert.equal(silencePromptStage(undefined), 1);
  assert.equal(silencePromptStage(2), 2);
});

for (const stageReached of [0, 1, 2, 3]) {
  test(`silence: genuine speech at stage ${stageReached} cancels every pending reminder`, () => {
    const c = new SilenceCheck();
    let t = 0;
    c.aiFinished(t);
    for (let i = 0; i < stageReached; i++) {
      t += 10_000;
      assert.equal(c.tick(t, idle)?.type, "prompt");
      c.aiStarted();
      c.aiFinished(t + 1_000);
      t += 1_000;
    }
    c.candidateActivity();
    assert.equal(c.currentStage, 0);
    assert.equal(c.tick(t + 60_000, idle), null); // nothing pending
    // Next silence starts again from stage 1 after the AI speaks.
    c.aiFinished(t + 60_000);
    assert.deepEqual(c.tick(t + 69_000, idle)?.type === "prompt" && (c.currentStage), 1);
  });
}

test("silence: background noise does not reset the timer (only candidateActivity does)", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  // Noise = no turn, no gated speech: ticks keep counting from 0.
  for (let t = 500; t < 9_000; t += 500) assert.equal(c.tick(t, idle), null);
  assert.equal(c.tick(9_000, idle)?.type, "prompt");
});

test("silence: speech in progress pauses but does not reset; the wait resumes afterwards", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(9_500, { ...idle, speechInProgress: true }), null);
  assert.equal(c.tick(10_000, idle)?.type, "prompt");
});

test("silence: never fires during an open candidate turn or while the AI is speaking", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(60_000, { ...idle, turnActive: true }), null);
  assert.equal(c.tick(60_000, { ...idle, aiBusy: true }), null);
  assert.equal(c.tick(60_000, { ...idle, speechInProgress: true }), null);
  assert.equal(c.currentStage, 0);
  // AI starts its reply → counting stops entirely until playback ends.
  c.aiStarted();
  assert.equal(c.tick(120_000, idle), null);
});

test("silence: relay busy → the same reminder is retried, not skipped past", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(9_000, idle)?.type, "prompt");
  c.promptRejected(9_100, C.silenceCheckSuppressMs);
  assert.equal(c.currentStage, 0);
  assert.equal(c.tick(9_100 + C.silenceCheckSuppressMs - 1, idle), null);
  const again = c.tick(9_100 + C.silenceFirstPromptMs, idle);
  assert.deepEqual(again && again.type === "prompt" ? again.stage : null, 1);
});

test("silence: skip refused while busy is retried later, never lost", () => {
  const c = new SilenceCheck({ ...C, silenceFirstPromptMs: 1, silencePromptGapMs: 1, silenceFinalWaitMs: 1, silenceCheckAiGraceMs: 0 });
  c.aiFinished(0);
  let t = 0;
  let a;
  do { t += 10; a = c.tick(t, idle); } while (!a || a.type !== "skip");
  c.skipRejected(t, 100);
  assert.equal(c.tick(t + 50, idle), null);
  assert.equal(c.tick(t + 101, idle)?.type, "skip");
});

test("silence: still progresses if the AI never speaks a reminder (grace), so it never waits forever", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(9_000, idle)?.type, "prompt");
  const next = 9_000 + C.silenceCheckAiGraceMs + C.silencePromptGapMs;
  assert.equal(c.tick(next - 1, idle), null);
  assert.equal(c.tick(next, idle)?.type, "prompt");
});

test("silence: candidate finished but the AI never replied → reminders still run", () => {
  const c = new SilenceCheck();
  c.candidateFinished(1_000);
  assert.equal(c.tick(10_000, idle)?.type, "prompt");
});

test("silence: suppressed while another prompt (check-in / watchdog) is in flight", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  c.suppress(8_000, 5_000);
  assert.equal(c.tick(12_999, idle), null);
  assert.equal(c.tick(13_000, idle), null); // waitingSince moved to 8s → fires at 17s
  assert.equal(c.tick(17_000, idle)?.type, "prompt");
});

test("silence: new question starts fresh", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  c.tick(9_000, idle);
  c.reset();
  assert.equal(c.tick(60_000, idle), null);
  assert.equal(c.attemptCount, 0);
});

test("silence cues: explicit no-answer advance", () => {
  assert.match(noAnswerAdvanceCue(3, "Tell me about X"), /^\[NO_ANSWER\].*question 3.*Tell me about X/);
  assert.match(noAnswerAdvanceCue(3, "Q"), /do NOT call signal_question_change/);
  assert.match(noAnswerAdvanceCue(0, null), /farewell/);
});

// ── Noise gate / VAD tuning ────────────────────────────────────────
test("noise gate: Silero speech only counts with recent voice-level mic energy", () => {
  assert.equal(hasRecentVoiceEnergy(10_000, 0), false); // never had voice
  assert.equal(hasRecentVoiceEnergy(10_000, 9_500), true);
  assert.equal(hasRecentVoiceEnergy(10_000, 10_000 - ENDPOINTING_CONFIG.voiceEnergyWindowMs - 1), false);
});

test("VAD tuning follows the Silero noisy-audio advice", () => {
  // High start threshold for noisy rooms, hysteresis below it, min speech length.
  assert.ok(ENDPOINTING_CONFIG.positiveSpeechThreshold >= 0.8);
  assert.ok(ENDPOINTING_CONFIG.negativeSpeechThreshold < ENDPOINTING_CONFIG.positiveSpeechThreshold);
  assert.ok(ENDPOINTING_CONFIG.positiveSpeechThreshold - ENDPOINTING_CONFIG.negativeSpeechThreshold >= 0.15);
  assert.ok(ENDPOINTING_CONFIG.minSpeechMs >= 250);
  assert.ok(ENDPOINTING_CONFIG.minSpeechFrames * SILERO_FRAME_MS >= 250);
  assert.equal(ENDPOINTING_CONFIG.model, "v5");
  // Barge-in stays stricter than a normal turn start.
  assert.ok(ENDPOINTING_CONFIG.bargeInSpeechThreshold >= ENDPOINTING_CONFIG.positiveSpeechThreshold);
});

test("VAD asset URLs are absolute and the processor falls back to ScriptProcessor", () => {
  assert.equal(absoluteAssetBase("/vad/", "https://dev.example.com"), "https://dev.example.com/vad/");
  assert.equal(absoluteAssetBase("/vad", "https://dev.example.com"), "https://dev.example.com/vad/");
  assert.equal(absoluteAssetBase("https://cdn.example.com/vad/", "https://x.com"), "https://cdn.example.com/vad/");
  assert.deepEqual(vadProcessorOrder(true), ["AudioWorklet", "ScriptProcessor"]);
  assert.deepEqual(vadProcessorOrder(false), ["ScriptProcessor"]);
});

// ── Playback / relay helpers ───────────────────────────────────────
test("jitter pre-roll grows after underruns and is capped", () => {
  let t: number = JITTER_BUFFER_TARGET_MS;
  t = nextJitterTargetMs(t);
  assert.ok(t > JITTER_BUFFER_TARGET_MS);
  for (let i = 0; i < 20; i++) t = nextJitterTargetMs(t);
  assert.equal(t, JITTER_BUFFER_ADAPTIVE_MAX_MS);
});

test("pcm16Rms: silence is 0, a loud tone is well above the voice level", () => {
  assert.equal(pcm16Rms(Buffer.alloc(320)), 0);
  const b = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) b.writeInt16LE(i % 2 ? 8000 : -8000, i * 2);
  assert.ok(pcm16Rms(b) > 0.2);
});
