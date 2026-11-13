/**
 * Tunable thresholds for client-side Silero VAD + smart end-of-turn detection.
 * Keep every pause / hesitation / barge-in knob here so behaviour is easy to adjust.
 */
export const ENDPOINTING_CONFIG = {
  /**
   * After this much silence, inspect the live transcript (done vs still thinking).
   * Kept short so clear short answers can end around donePauseMs (~1.5s).
   */
  decisionAfterSilenceMs: 700,

  /** Clear, complete short/medium answer → end the turn after this much silence. */
  donePauseMs: 1_500,

  /**
   * Once the candidate has been speaking this long (e.g. a self-intro), natural
   * between-sentence pauses must NOT end the turn as quickly as a short answer.
   */
  longAnswerSpeechMs: 8_000,

  /** Silence required to end a long-running answer that still looks complete. */
  longAnswerDonePauseMs: 3_000,

  /**
   * Stutter / unfinished-looking answer → keep listening this long before
   * closing the turn (and maybe asking a once-per-question check-in).
   */
  hesitantPauseMs: 5_500,

  /** Hard cap on silence before we always end the turn. */
  maxPauseMs: 6_500,

  /**
   * If the candidate resumes speaking this soon after we closed a turn,
   * treat it as a continuation (re-open the turn / barge-in) rather than a
   * brand-new answer after the AI already moved on.
   */
  continuationWindowMs: 3_000,

  /**
   * When an unfinished-looking answer stays silent through the full hold,
   * ask once whether they want to add more (relay sends [ANSWER_CHECK_IN]).
   * Never used for clear complete answers.
   */
  checkInOncePerQuestion: true,

  // ── Silero MicVAD frame-processor knobs ──────────────────────────
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  /**
   * Silence grace before MicVAD fires onSpeechEnd. Higher = brief breaths /
   * comma pauses inside a long answer stay “in speech” and do not start the
   * end-of-turn countdown.
   */
  redemptionMs: 900,
  preSpeechPadMs: 300,
  minSpeechMs: 120,

  // ── Barge-in (candidate talking over the AI) ─────────────────────
  /** Silero probability a frame needs to count toward a barge-in. */
  bargeInSpeechThreshold: 0.85,
  /** Legacy frame count (32ms frames); kept for reference — bargeInMinSpeechMs rules. */
  bargeInMinFrames: 13,
  /**
   * Sustained confident speech needed before the AI's voice is cut. Short
   * blips, breaths, coughs and speaker echo stay below this, so they no
   * longer chop the AI mid-sentence.
   */
  bargeInMinSpeechMs: 400,
  /** Low-probability frames tolerated inside a barge-in streak (natural dips). */
  bargeInMaxDipFrames: 2,
  /** Mic level (float32 RMS) the latest chunk must reach — echo after echo-cancellation is quieter. */
  bargeInMinRms: 0.012,

  // ── Stuck-turn guard ─────────────────────────────────────────────
  /**
   * Hard cap on one candidate turn. A turn left open longer than this (Silero
   * never reported speech end — background noise, a missed misfire) is closed
   * so the AI can reply. The candidate can keep talking; a new turn opens.
   */
  maxTurnMs: 90_000,
  /** Open turn with no voice-level mic energy for this long → close it. */
  turnNoVoiceForceEndMs: 8_000,

  // ── Silent-candidate check ("Hello, are you there?") ─────────────
  /** Silence after the AI finishes a question before the first check. */
  silenceCheckAfterMs: 10_000,
  /** Silence after a check before the next one. */
  silenceCheckRepeatMs: 10_000,
  /** Spoken checks before showing the on-screen microphone prompt. */
  silenceCheckSpokenMax: 2,
  /**
   * If the relay/AI never speaks a check, start counting again after this long
   * so the sequence can't stall.
   */
  silenceCheckAiGraceMs: 6_000,
  /**
   * After a check-in / reply-watchdog / reconnect cue, hold silence checks for
   * this long so two prompts never fire together.
   */
  silenceCheckSuppressMs: 8_000,

  baseAssetPath: "/vad/",
  onnxWASMBasePath: "/vad/",
  model: "v5" as const,

  loadTimeoutMs: 8_000,
} as const;

export type EndpointingConfig = typeof ENDPOINTING_CONFIG;
