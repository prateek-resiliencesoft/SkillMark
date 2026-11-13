/**
 * Safety net for the browser Silero VAD gate.
 *
 * With client VAD on, mic audio only reaches the voice AI while Silero has
 * opened a turn. If Silero never fires on a candidate's setup (quiet mic,
 * noise suppression, headset, a stalled audio worklet…) the AI hears nothing
 * while the recording still captures the answers. This watcher looks at the
 * raw mic level and Silero's frame activity and tells the caller when to give
 * up on client VAD for the rest of the session (the relay then switches the
 * voice AI to its own speech detection).
 *
 * Pure logic — no browser APIs — so it can be unit-tested.
 */

export const VAD_FAILSAFE_CONFIG = {
  /** A chunk is voice-level when its RMS is this many times the running noise floor… */
  noiseFloorRatio: 3,
  /** …and at least this loud (float32 RMS, ~-48 dBFS), so a dead-quiet room's hiss never counts. */
  absoluteMinRms: 0.004,
  /** Continuous-ish voice-level mic energy with no turn open → fall back. */
  sustainedVoiceMs: 1_500,
  /** Total voice-level energy (not necessarily continuous) with no turn opened this question → fall back. */
  cumulativeVoiceMs: 4_000,
  /** Silero must report at least one frame within this long after it started. */
  noFramesMs: 4_000,
  /** Silero frames stopped arriving for this long while the mic is live. */
  stalledFramesMs: 5_000,
  /** Per-question warning: this much voice-level mic energy but no transcript. */
  questionMissedVoiceMs: 2_000,
} as const;

export type FailsafeReason =
  | "vad_no_frames"
  | "vad_stalled"
  | "mic_voice_without_vad_turn"
  | "mic_voice_without_vad_turn_cumulative"
  | "question_without_transcript";

export type MicChunk = {
  now: number;
  rms: number;
  durationMs: number;
  /** AI audio is playing (or in its short echo tail). */
  aiSpeaking: boolean;
  /** A client-VAD user turn is currently open. */
  turnActive: boolean;
};

export type QuestionReport = {
  voicedMs: number;
  transcriptChars: number;
  turnsOpened: number;
};

export class VadFailsafe {
  private noiseFloor: number | null = null;
  private sustainedMs = 0;
  private cumulativeNoTurnMs = 0;
  private vadStartedAt: number | null = null;
  private framesSeen = 0;
  private lastFrameAt = 0;
  private lastChunkAt = 0;
  private q: QuestionReport = { voicedMs: 0, transcriptChars: 0, turnsOpened: 0 };
  private tripped = false;

  constructor(private readonly cfg: typeof VAD_FAILSAFE_CONFIG = VAD_FAILSAFE_CONFIG) {}

  get noiseFloorRms(): number | null {
    return this.noiseFloor;
  }

  /** Silero started (client VAD active). */
  vadStarted(now: number) {
    this.vadStartedAt = now;
    this.framesSeen = 0;
    this.lastFrameAt = now;
  }

  /** Every Silero frame (onFrameProcessed). */
  vadFrame(now: number) {
    this.framesSeen += 1;
    this.lastFrameAt = now;
  }

  /** A client-VAD turn opened — Silero is hearing the candidate. */
  turnOpened() {
    this.q.turnsOpened += 1;
    this.sustainedMs = 0;
    this.cumulativeNoTurnMs = 0;
  }

  /** Any candidate transcript (speech-to-text or typed answer) arrived. */
  transcript(chars: number) {
    if (chars > 0) this.q.transcriptChars += chars;
  }

  /** Close out the question that just ended and start counting the next one. */
  endQuestion(): QuestionReport {
    const report = this.q;
    this.q = { voicedMs: 0, transcriptChars: 0, turnsOpened: 0 };
    this.sustainedMs = 0;
    this.cumulativeNoTurnMs = 0;
    return report;
  }

  isVoiceLevel(rms: number): boolean {
    if (rms < this.cfg.absoluteMinRms) return false;
    // Before any floor exists we can't tell voice from steady noise.
    if (this.noiseFloor == null) return false;
    return rms >= this.noiseFloor * this.cfg.noiseFloorRatio;
  }

  private updateNoiseFloor(rms: number) {
    if (this.noiseFloor == null) {
      this.noiseFloor = rms;
      return;
    }
    // Drop quickly to quiet moments (pauses between words), rise slowly.
    this.noiseFloor =
      rms < this.noiseFloor
        ? this.noiseFloor * 0.6 + rms * 0.4
        : this.noiseFloor + (rms - this.noiseFloor) * 0.02;
  }

  /**
   * Feed one mic chunk. Returns a reason when client VAD should be abandoned
   * (only once; call reset() if it is ever re-armed). `clientVad` false means
   * we only collect per-question stats.
   */
  micChunk(c: MicChunk, clientVad: boolean): FailsafeReason | null {
    this.lastChunkAt = c.now;
    const voiced = this.isVoiceLevel(c.rms);
    // Classify against the floor *before* this chunk so speech can't hide itself.
    this.updateNoiseFloor(c.rms);

    if (c.aiSpeaking) {
      // Echo of the AI voice is not candidate speech.
      this.sustainedMs = Math.max(0, this.sustainedMs - c.durationMs);
      return null;
    }
    if (voiced) this.q.voicedMs += c.durationMs;

    if (!clientVad || this.tripped) return null;

    // Silero never produced a frame / stopped producing frames.
    if (this.vadStartedAt != null) {
      if (this.framesSeen === 0 && c.now - this.vadStartedAt >= this.cfg.noFramesMs) {
        return this.trip("vad_no_frames");
      }
      if (this.framesSeen > 0 && c.now - this.lastFrameAt >= this.cfg.stalledFramesMs) {
        return this.trip("vad_stalled");
      }
    }

    if (c.turnActive) {
      this.sustainedMs = 0;
      this.cumulativeNoTurnMs = 0;
      return null;
    }

    if (voiced) {
      this.sustainedMs += c.durationMs;
      this.cumulativeNoTurnMs += c.durationMs;
    } else {
      // Short gaps between words don't reset the run; real silence drains it.
      this.sustainedMs = Math.max(0, this.sustainedMs - c.durationMs / 2);
    }
    if (this.sustainedMs >= this.cfg.sustainedVoiceMs) return this.trip("mic_voice_without_vad_turn");
    if (this.cumulativeNoTurnMs >= this.cfg.cumulativeVoiceMs) {
      return this.trip("mic_voice_without_vad_turn_cumulative");
    }
    return null;
  }

  /** Should a finished question be flagged (voice on the mic, nothing transcribed)? */
  questionMissed(r: QuestionReport): boolean {
    return r.transcriptChars === 0 && r.voicedMs >= this.cfg.questionMissedVoiceMs;
  }

  /** Mark tripped from outside (e.g. question safety net). */
  trip(reason: FailsafeReason): FailsafeReason {
    this.tripped = true;
    return reason;
  }

  get hasTripped(): boolean {
    return this.tripped;
  }

  /** Diagnostics for logs. */
  snapshot() {
    return {
      noiseFloor: this.noiseFloor == null ? null : Number(this.noiseFloor.toFixed(4)),
      sileroFrames: this.framesSeen,
      msSinceLastFrame: this.lastFrameAt ? Math.round(this.lastChunkAt - this.lastFrameAt) : null,
      questionVoicedMs: Math.round(this.q.voicedMs),
      questionTurnsOpened: this.q.turnsOpened,
    };
  }
}
