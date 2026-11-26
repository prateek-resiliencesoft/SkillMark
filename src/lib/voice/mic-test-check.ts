import { resolveInterviewLanguage } from "@/lib/interview-language";

/**
 * Pass/fail rules for the pre-interview speaker + microphone check.
 * Kept pure so unit tests can cover quiet / short / clipping cases.
 */
export const MIC_TEST_CHECK = {
  /**
   * Pass as soon as this much speech is heard (Silero or energy). About half
   * of "my microphone is working": a partial sentence is enough.
   */
  minSpeechMs: 1_000,
  /** When listening times out, a shorter but clear voice still passes. */
  minSpeechMsAtTimeout: 500,
  /** Stop listening after this long and decide with what was heard. */
  listenTimeoutMs: 8_000,
  /** Silence played before the prompt so a waking speaker can't clip its start. */
  playbackLeadInSec: 0.4,
  /** RMS while speaking — below this is "too quiet / move closer". */
  minSpeechRms: 0.012,
  /** Peak RMS below this means we never heard a clear voice. */
  minPeakRms: 0.02,
  /** Peak at or above this is treated as clipping / too loud. */
  clipPeakRms: 0.92,
  /** Optional: average silence energy this high suggests noisy room. */
  maxNoiseFloorRms: 0.02,
} as const;

export type MicTestFailReason =
  | "no_speech"
  | "too_short"
  | "too_quiet"
  | "clipping"
  | "noisy";

export interface MicTestStats {
  /** Milliseconds of frames classified as speech (Silero preferred). */
  speechMs: number;
  peakRms: number;
  /** Mean RMS of speech frames only (0 if none). */
  meanSpeechRms: number;
  /** Mean RMS of non-speech frames (noise floor). */
  noiseFloorRms?: number;
}

export interface MicTestVerdict {
  pass: boolean;
  reason?: MicTestFailReason;
  message: string;
}

/**
 * `final`: listening ended (timeout), so judge what was heard with the
 * shorter minimum instead of waiting for more speech.
 */
export function evaluateMicTest(stats: MicTestStats, opts: { final?: boolean } = {}): MicTestVerdict {
  const minSpeechMs = opts.final ? MIC_TEST_CHECK.minSpeechMsAtTimeout : MIC_TEST_CHECK.minSpeechMs;
  if (stats.speechMs <= 0 || stats.peakRms < MIC_TEST_CHECK.minPeakRms * 0.5) {
    return {
      pass: false,
      reason: "no_speech",
      message:
        "We couldn't hear you. Check your microphone, then press Retry and say the sentence.",
    };
  }
  if (stats.peakRms >= MIC_TEST_CHECK.clipPeakRms) {
    return {
      pass: false,
      reason: "clipping",
      message:
        "Your microphone is too loud or clipping. Move a bit farther away and retry.",
    };
  }
  if (stats.speechMs < minSpeechMs) {
    return {
      pass: false,
      reason: "too_short",
      message:
        "That was too short. Press Retry and say the full sentence.",
    };
  }
  if (
    stats.meanSpeechRms > 0 &&
    stats.meanSpeechRms < MIC_TEST_CHECK.minSpeechRms
  ) {
    return {
      pass: false,
      reason: "too_quiet",
      message:
        "We couldn't hear you clearly — move closer to the mic or speak a little louder, then retry.",
    };
  }
  if (
    typeof stats.noiseFloorRms === "number" &&
    stats.noiseFloorRms >= MIC_TEST_CHECK.maxNoiseFloorRms &&
    stats.meanSpeechRms > 0 &&
    stats.meanSpeechRms < stats.noiseFloorRms * 2.5
  ) {
    return {
      pass: false,
      reason: "noisy",
      message:
        "There's too much background noise. Reduce noise around you and retry.",
    };
  }
  return {
    pass: true,
    message: "Audio test passed. Your speaker and microphone are working.",
  };
}

/**
 * Public asset for the Kore-voice speaker clip.
 * Prefer 48 kHz MP3 (simple HTMLAudioElement decode); WAV also available at 48 kHz.
 */
export function micTestAudioSrc(language?: string, format: "mp3" | "wav" = "mp3"): string {
  const key = resolveInterviewLanguage(language);
  const base =
    key === "zh" ? "mic-test-zh" : key === "hi" ? "mic-test-hi" : "mic-test-en";
  return `/audio/${base}.${format}`;
}
