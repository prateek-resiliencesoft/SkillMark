/**
 * Pure turn-taking helpers for the voice interview (no browser APIs, unit-tested):
 *  - BargeInDetector: only cut the AI's voice on sustained candidate speech.
 *  - stuckTurnReason: close a candidate turn that never got a speech-end.
 *  - SilenceCheck: staged reminders, then the next question, when the candidate says nothing.
 */
import { ENDPOINTING_CONFIG } from "./endpointing-config";
import { SILENCE_PROMPTS } from "./relay-keepalive";

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

export { SILENCE_PROMPTS };

export type SilencePromptStage = 1 | 2 | 3;

export type SilenceCheckAction =
  | { type: "prompt"; stage: SilencePromptStage; text: string }
  | { type: "skip"; policy: Cfg["silencePolicy"] };

export type SilenceCfg = {
  silenceFirstPromptMs: number;
  silencePromptGapMs: number;
  silenceFinalWaitMs: number;
  silenceCheckAiGraceMs: number;
  silencePolicy: Cfg["silencePolicy"];
};

/**
 * Staged silence handling after the AI finishes asking (timed from the end of
 * AI playback, never from generation):
 *   9s silence → "Are you there? Can you hear me?"
 *   5s more    → "I can't hear your response. Are you still connected?"
 *   5s more    → "It seems you've gone silent. I'll wait a little longer."
 *   8s more    → silence policy (default: next question, left unanswered).
 * Each wait restarts when the reminder finishes playing.
 * Only genuine candidate speech (a gated VAD turn, or transcribed words) calls
 * candidateActivity() and cancels everything. Noise never resets the timer.
 * Nothing fires while a candidate turn is open, speech is in progress, or the
 * AI is speaking.
 */
export class SilenceCheck {
  private waitingSince: number | null = null;
  private stage = 0; // reminders already sent for this question (0–3)
  private suppressedUntil = 0;
  private done = false;

  constructor(private readonly cfg: SilenceCfg = ENDPOINTING_CONFIG) {}

  /** Reminders sent so far for this question (0–3). */
  get attemptCount() {
    return this.stage;
  }

  get currentStage() {
    return this.stage;
  }

  get isWaiting() {
    return this.waitingSince != null;
  }

  get isDone() {
    return this.done;
  }

  /** AI playback ended (question or reminder). Start / restart the wait. */
  aiFinished(now: number) {
    if (this.done) return;
    this.waitingSince = now;
  }

  /** The AI started speaking again — pause counting until it finishes. */
  aiStarted() {
    this.waitingSince = null;
  }

  /** Genuine candidate speech. Cancel every pending reminder. */
  candidateActivity() {
    this.waitingSince = null;
    this.stage = 0;
    this.done = false;
  }

  /**
   * The candidate's turn closed. If the AI then never replies, count from here
   * so we still never listen forever (the AI's reply pauses this as usual).
   */
  candidateFinished(now: number) {
    this.stage = 0;
    this.done = false;
    this.waitingSince = now;
  }

  /** New question: start fresh (counting begins when the AI finishes asking it). */
  reset() {
    this.waitingSince = null;
    this.stage = 0;
    this.done = false;
    this.suppressedUntil = 0;
  }

  /** Another prompt (check-in, reply watchdog, reconnect) is in flight. */
  suppress(now: number, ms: number) {
    this.suppressedUntil = Math.max(this.suppressedUntil, now + ms);
    if (this.waitingSince != null) this.waitingSince = Math.max(this.waitingSince, now);
  }

  /** The relay refused the last reminder (busy) — step back so it is retried. */
  promptRejected(now: number, suppressMs: number) {
    if (this.stage > 0) this.stage -= 1;
    this.done = false;
    this.waitingSince = now;
    this.suppress(now, suppressMs);
  }

  /** The relay refused the skip because it was busy — retry after a pause. */
  skipRejected(now: number, suppressMs: number) {
    this.done = false;
    this.waitingSince = now;
    this.suppress(now, suppressMs);
  }

  private limitMs(): number {
    if (this.stage === 0) return this.cfg.silenceFirstPromptMs;
    if (this.stage < SILENCE_PROMPTS.length) return this.cfg.silencePromptGapMs;
    return this.cfg.silenceFinalWaitMs;
  }

  tick(
    now: number,
    s: { turnActive: boolean; aiBusy: boolean; speechInProgress: boolean },
  ): SilenceCheckAction | null {
    if (this.waitingSince == null || this.done) return null;
    if (s.turnActive || s.aiBusy || s.speechInProgress) return null;
    if (now < this.suppressedUntil) return null;
    if (now - this.waitingSince < this.limitMs()) return null;

    if (this.stage < SILENCE_PROMPTS.length) {
      this.stage += 1;
      // Normally the reminder's playback restarts the wait (aiStarted/aiFinished).
      // If the AI never speaks it, keep counting after a grace period.
      this.waitingSince = now + this.cfg.silenceCheckAiGraceMs;
      const stage = this.stage as SilencePromptStage;
      return { type: "prompt", stage, text: SILENCE_PROMPTS[stage - 1] };
    }
    this.done = true;
    this.waitingSince = null;
    return { type: "skip", policy: this.cfg.silencePolicy };
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
