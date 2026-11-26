/**
 * Single tunable config for the candidate microphone VU meter + guidance.
 * UI-only: nothing here feeds transcription, turn-taking or evaluation.
 * All levels are dBFS (0 = digital full scale), all times are ms.
 */
export const LEVEL_CONFIG = {
  /** Values below this are clamped (silence / NaN / -Infinity never reach the UI). */
  floorDb: -90,
  /** Meter scale shown on screen. */
  scaleMinDb: -60,
  scaleMaxDb: 0,

  /** Level bands (upper bounds). Boundary values belong to the higher band. */
  tooQuietBelowDb: -45,
  quietBelowDb: -30,
  goodBelowDb: -12,
  loudBelowDb: -6,
  /** A band change needs to cross its boundary by this much (status hysteresis). */
  hysteresisDb: 2,

  /** Frame counts as "voice activity" above this (room noise sits below it). */
  voiceActivityDb: -55,
  /** A sample peak at/above this counts as a clipping frame even if RMS is lower. */
  clipPeakDb: -0.5,

  /** Low-volume warning: ~4s of voice that stays quiet while the candidate should speak. */
  lowSustainMs: 4000,
  /** Voice must be present in at least this share of frames in the window. */
  minVoiceActivityRatio: 0.15,
  /** Quiet = this percentile of the voiced frames stays below `quietBelowDb`. */
  speechPercentile: 0.85,
  /** Too-loud warning: sustained clipping/near-clip. */
  loudSustainMs: 1500,
  /** Share of voiced frames that must be loud over `loudSustainMs`. */
  loudFrameRatio: 0.5,
  /** Warning clears after the level has been healthy this long (median of voiced frames). */
  recoverMs: 1000,
  /** Status label looks at the loudest level in this window (no flicker between sentences). */
  statusWindowMs: 2500,
  /** Candidate's turn and nothing but silence this long -> subtle "not detected" status (no banner). */
  noSignalMs: 10000,
  /** Evaluate guidance at most this often. */
  evalIntervalMs: 100,
  /** A gap longer than this between frames (background tab) resets history. */
  gapResetMs: 1000,

  /** Display ballistics. */
  attackTauMs: 25,
  releaseDbPerSec: 30,
  peakHoldMs: 1500,
  peakDecayDbPerSec: 20,

  messages: {
    tooQuiet:
      "Your voice is too low. Please move closer to your microphone or increase your microphone volume.",
    good: "Your voice level is good. Keep speaking.",
    tooLoud: "Your voice is too loud. Please reduce your microphone volume.",
    muted: "Your microphone is muted. Unmute it to answer.",
    disconnected: "Your microphone was disconnected. Reconnect it or check your device settings.",
    noPermission: "Microphone access is blocked. Allow microphone permission in your browser.",
  },
} as const;

export type LevelConfig = typeof LEVEL_CONFIG;
