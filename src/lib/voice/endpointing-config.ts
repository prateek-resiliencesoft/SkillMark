/**
 * Tunable thresholds for client-side Silero VAD + smart end-of-turn detection.
 * Keep every pause / hesitation / barge-in knob here so behaviour is easy to adjust.
 */
export const ENDPOINTING_CONFIG = {
  /**
   * After this much silence, inspect the live transcript (done vs still thinking).
   * Kept short so clear answers can end around donePauseMs (~1.5s).
   */
  decisionAfterSilenceMs: 700,

  /** Clear, complete-sounding answer → end the turn after this much silence. */
  donePauseMs: 1_500,

  /**
   * Stutter / unfinished-looking answer → keep listening this long before
   * closing the turn (and maybe asking a once-per-question check-in).
   */
  hesitantPauseMs: 5_500,

  /** Hard cap on silence before we always end the turn. */
  maxPauseMs: 6_500,

  /**
   * When an unfinished-looking answer stays silent through the full hold,
   * ask once whether they want to add more (relay sends [ANSWER_CHECK_IN]).
   * Never used for clear complete answers.
   */
  checkInOncePerQuestion: true,

  // ── Silero MicVAD frame-processor knobs ──────────────────────────
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  /** Silence grace before MicVAD fires onSpeechEnd (~short gaps stay in-speech). */
  redemptionMs: 400,
  preSpeechPadMs: 300,
  minSpeechMs: 120,

  /**
   * While the AI is talking, require this higher confidence before we treat
   * mic energy as a real barge-in (rejects speaker echo / room noise).
   */
  bargeInSpeechThreshold: 0.85,
  bargeInMinFrames: 10,

  baseAssetPath: "/vad/",
  onnxWASMBasePath: "/vad/",
  model: "v5" as const,

  loadTimeoutMs: 8_000,
} as const;

export type EndpointingConfig = typeof ENDPOINTING_CONFIG;
