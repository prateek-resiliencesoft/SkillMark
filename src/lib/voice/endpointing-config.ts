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

  bargeInSpeechThreshold: 0.85,
  bargeInMinFrames: 10,

  baseAssetPath: "/vad/",
  onnxWASMBasePath: "/vad/",
  model: "v5" as const,

  loadTimeoutMs: 8_000,
} as const;

export type EndpointingConfig = typeof ENDPOINTING_CONFIG;
