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
  | { type: "show_prompt"; attempt: number };

/**
 * After the AI finishes speaking, counts candidate silence.
 *  1st / 2nd timeout → ask the AI to say a short "are you there?" check.
 *  next timeout      → show the on-screen microphone prompt (once).
 * Any candidate speech (a turn opening, or voice-level mic energy) resets it.
 * It never advances the question and never counts as an answer.
 */
export class SilenceCheck {
  private waitingSince: number | null = null;
  private attempts = 0;
  private suppressedUntil = 0;
  private promptShown = false;

  constructor(private readonly cfg: Pick<Cfg, "silenceCheckAfterMs" | "silenceCheckRepeatMs" | "silenceCheckSpokenMax" | "silenceCheckAiGraceMs"> = ENDPOINTING_CONFIG) {}

  get attemptCount() {
    return this.attempts;
  }

  get isWaiting() {
    return this.waitingSince != null;
  }

  /** The AI finished speaking (its question, or a check). Start / restart the count. */
  aiFinished(now: number) {
    if (this.promptShown) return;
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
    this.promptShown = false;
  }

  /** New question: start fresh (counting begins when the AI finishes asking it). */
  reset() {
    this.waitingSince = null;
    this.attempts = 0;
    this.promptShown = false;
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
    if (this.waitingSince == null || this.promptShown) return null;
    if (s.turnActive || s.aiBusy || s.voiceOnMic) return null;
    if (now < this.suppressedUntil) return null;
    const limit = this.attempts === 0 ? this.cfg.silenceCheckAfterMs : this.cfg.silenceCheckRepeatMs;
    if (now - this.waitingSince < limit) return null;

    this.attempts += 1;
    if (this.attempts <= this.cfg.silenceCheckSpokenMax) {
      // If the AI never speaks the check, keep counting after a grace period.
      this.waitingSince = now + this.cfg.silenceCheckAiGraceMs;
      return { type: "ask", attempt: this.attempts };
    }
    this.promptShown = true;
    this.waitingSince = null;
    return { type: "show_prompt", attempt: this.attempts };
  }
}
