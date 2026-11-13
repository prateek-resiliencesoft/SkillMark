/**
 * Pure turn-taking helpers for the voice interview (no browser APIs, unit-tested):
 *  - BargeInDetector: only cut the AI's voice on sustained candidate speech.
 *  - stuckTurnReason: close a candidate turn that never got a speech-end.
 *  - SilenceCheck: "Hello, are you there?" when the candidate says nothing.
 */
import { ENDPOINTING_CONFIG } from "./endpointing-config";

type Cfg = typeof ENDPOINTING_CONFIG;

/** Silero v5 frames are 512 samples at 16 kHz. */
export const SILERO_FRAME_MS = 32;

export class BargeInDetector {
  private speechMs = 0;
  private dips = 0;

  constructor(private readonly cfg: Pick<Cfg, "bargeInSpeechThreshold" | "bargeInMinSpeechMs" | "bargeInMaxDipFrames" | "bargeInMinRms"> = ENDPOINTING_CONFIG) {}

  reset() {
    this.speechMs = 0;
    this.dips = 0;
  }

  get sustainedMs() {
    return this.speechMs;
  }

  /**
   * Feed one Silero frame. `rms` is the latest mic chunk level (float32 RMS).
   * Returns true once speech has been confident and loud enough for
   * `bargeInMinSpeechMs` (then resets).
   */
  feed(probability: number, rms: number, frameMs = SILERO_FRAME_MS): boolean {
    const voiced = probability >= this.cfg.bargeInSpeechThreshold && rms >= this.cfg.bargeInMinRms;
    if (voiced) {
      this.speechMs += frameMs;
      this.dips = 0;
    } else if (this.speechMs > 0 && this.dips < this.cfg.bargeInMaxDipFrames) {
      this.dips += 1;
    } else {
      this.reset();
    }
    if (this.speechMs >= this.cfg.bargeInMinSpeechMs) {
      this.reset();
      return true;
    }
    return false;
  }
}

export type StuckTurnReason = "max_turn_length" | "no_voice";

/**
 * A candidate turn is open (activity_start sent) but the normal end-of-turn
 * logic hasn't closed it. Returns why it should be force-closed, or null.
 * `endpointPending` = the normal end-of-turn countdown is already running.
 */
export function stuckTurnReason(
  input: {
    now: number;
    turnOpenedAt: number;
    lastVoiceAt: number;
    endpointPending: boolean;
  },
  cfg: { maxTurnMs: number; turnNoVoiceForceEndMs: number } = ENDPOINTING_CONFIG,
): StuckTurnReason | null {
  const { now, turnOpenedAt, lastVoiceAt, endpointPending } = input;
  if (now - turnOpenedAt >= cfg.maxTurnMs) return "max_turn_length";
  if (endpointPending) return null;
  const lastVoice = Math.max(turnOpenedAt, lastVoiceAt);
  if (now - lastVoice >= cfg.turnNoVoiceForceEndMs) return "no_voice";
  return null;
}

export type SilenceCheckAction =
  | { type: "ask"; attempt: number }
  | { type: "skip"; attempt: number };

/**
 * After the AI finishes asking, counts candidate silence.
 *  ~3s silence  → ask the AI to say a short "Are you there?".
 *  ~4s more     → move on to the next question (marked unanswered).
 * Any candidate speech (a turn opening, or voice-level mic energy) resets it.
 */
export class SilenceCheck {
  private waitingSince: number | null = null;
  private attempts = 0;
  private suppressedUntil = 0;
  private done = false;

  constructor(private readonly cfg: Pick<Cfg, "silenceCheckAfterMs" | "silenceSkipAfterMs" | "silenceCheckAiGraceMs"> = ENDPOINTING_CONFIG) {}

  get attemptCount() {
    return this.attempts;
  }

  get isWaiting() {
    return this.waitingSince != null;
  }

  /** The AI finished speaking (its question, or a check). Start / restart the count. */
  aiFinished(now: number) {
    if (this.done) return;
    this.waitingSince = now;
  }

  /** The AI started speaking again — pause counting until it finishes. */
  aiStarted() {
    this.waitingSince = null;
  }

  /** The candidate spoke. Clear everything. */
  candidateActivity() {
    this.waitingSince = null;
    this.attempts = 0;
    this.done = false;
  }

  /** New question: start fresh (counting begins when the AI finishes asking it). */
  reset() {
    this.waitingSince = null;
    this.attempts = 0;
    this.done = false;
    this.suppressedUntil = 0;
  }

  /** Another prompt (check-in, reply watchdog, reconnect) is in flight. */
  suppress(now: number, ms: number) {
    this.suppressedUntil = Math.max(this.suppressedUntil, now + ms);
    if (this.waitingSince != null) this.waitingSince = Math.max(this.waitingSince, now);
  }

  tick(
    now: number,
    s: { turnActive: boolean; aiBusy: boolean; voiceOnMic: boolean },
  ): SilenceCheckAction | null {
    if (this.waitingSince == null || this.done) return null;
    if (s.turnActive || s.aiBusy || s.voiceOnMic) return null;
    if (now < this.suppressedUntil) return null;
    const limit = this.attempts === 0 ? this.cfg.silenceCheckAfterMs : this.cfg.silenceSkipAfterMs;
    if (now - this.waitingSince < limit) return null;

    this.attempts += 1;
    if (this.attempts === 1) {
      // If the AI never speaks the check, keep counting after a grace period.
      this.waitingSince = now + this.cfg.silenceCheckAiGraceMs;
      return { type: "ask", attempt: 1 };
    }
    this.done = true;
    this.waitingSince = null;
    return { type: "skip", attempt: this.attempts };
  }
}

/**
 * Noise gate for Silero: a "speech" decision only counts when the mic also
 * carried voice-level energy (above the adaptive noise floor) very recently.
 */
export function hasRecentVoiceEnergy(
  now: number,
  lastVoiceAt: number,
  windowMs: number = ENDPOINTING_CONFIG.voiceEnergyWindowMs,
): boolean {
  return lastVoiceAt > 0 && now - lastVoiceAt <= windowMs;
}
