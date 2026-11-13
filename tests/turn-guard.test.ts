import assert from "node:assert/strict";
import test from "node:test";

import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";
import { BargeInDetector, SILERO_FRAME_MS, SilenceCheck, stuckTurnReason, hasRecentVoiceEnergy } from "@/lib/voice/turn-guard";
import { absoluteAssetBase, vadProcessorOrder } from "@/lib/voice/silero-vad-client";
import { nextJitterTargetMs, JITTER_BUFFER_ADAPTIVE_MAX_MS, JITTER_BUFFER_TARGET_MS } from "@/lib/voice/playback-jitter-buffer";
import { pcm16Rms, silenceCheckCue, noAnswerAdvanceCue } from "@/lib/voice/relay-keepalive";

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

// ── Silence check ──────────────────────────────────────────────────
const idle = { turnActive: false, aiBusy: false, voiceOnMic: false };

test("silence check: asks \"Are you there?\" after 3s, then moves on 4s after the AI finishes asking", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(2_900, idle), null);
  assert.deepEqual(c.tick(3_000, idle), { type: "ask", attempt: 1 });
  // AI speaks the check, finishes at 4.5s
  c.aiStarted();
  assert.equal(c.tick(4_000, idle), null);
  c.aiFinished(4_500);
  assert.equal(c.tick(8_400, idle), null);
  assert.deepEqual(c.tick(8_500, idle), { type: "skip", attempt: 2 });
  // Only once per question
  assert.equal(c.tick(60_000, idle), null);
});

test("silence check: never fires while the candidate talks, the AI talks, or the mic has voice", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.equal(c.tick(20_000, { ...idle, turnActive: true }), null);
  assert.equal(c.tick(20_000, { ...idle, aiBusy: true }), null);
  assert.equal(c.tick(20_000, { ...idle, voiceOnMic: true }), null);
});

test("silence check: candidate speech (thinking out loud) resets the sequence — no skip", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.deepEqual(c.tick(3_000, idle), { type: "ask", attempt: 1 });
  c.candidateActivity();
  assert.equal(c.attemptCount, 0);
  assert.equal(c.tick(50_000, idle), null); // not waiting until the AI speaks again
  c.aiFinished(50_000);
  assert.deepEqual(c.tick(53_000, idle), { type: "ask", attempt: 1 });
});

test("silence check: suppressed while another prompt (check-in / watchdog) is in flight", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  c.suppress(2_000, 5_000);
  assert.equal(c.tick(3_000, idle), null);
  assert.equal(c.tick(6_900, idle), null);
  assert.deepEqual(c.tick(7_000, idle), { type: "ask", attempt: 1 });
});

test("silence check: still moves on if the AI never speaks the check", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  assert.deepEqual(c.tick(3_000, idle), { type: "ask", attempt: 1 });
  const next = 3_000 + ENDPOINTING_CONFIG.silenceCheckAiGraceMs + ENDPOINTING_CONFIG.silenceSkipAfterMs;
  assert.equal(c.tick(next - 1, idle), null);
  assert.deepEqual(c.tick(next, idle), { type: "skip", attempt: 2 });
});

test("silence check: new question starts fresh", () => {
  const c = new SilenceCheck();
  c.aiFinished(0);
  c.tick(3_000, idle);
  c.reset();
  assert.equal(c.tick(30_000, idle), null);
  assert.equal(c.attemptCount, 0);
});

test("silence cues: short \"Are you there?\" and an explicit no-answer advance", () => {
  assert.match(silenceCheckCue(1), /^\[SILENCE_CHECK\]/);
  assert.match(silenceCheckCue(1), /are you there/i);
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
