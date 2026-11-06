/**
 * Pass/fail rules for the pre-interview speaker + microphone check.
 * Kept pure so unit tests can cover quiet / short / clipping cases.
 */
export const MIC_TEST_CHECK = {
  /** Real speech must be detected at least this long (Silero or energy). */
  minSpeechMs: 1_500,
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

export function evaluateMicTest(stats: MicTestStats): MicTestVerdict {
  if (stats.speechMs <= 0 || stats.peakRms < MIC_TEST_CHECK.minPeakRms * 0.5) {
    return {
      pass: false,
      reason: "no_speech",
      message:
        "We couldn't hear you. Check the selected microphone, then say the sample sentence clearly.",
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
  if (stats.speechMs < MIC_TEST_CHECK.minSpeechMs) {
    return {
      pass: false,
      reason: "too_short",
      message:
        "That was too short. Please say the full sample sentence in a normal speaking voice.",
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
  const zh = (language || "").toLowerCase().startsWith("zh");
  const base = zh ? "mic-test-zh" : "mic-test-en";
  return `/audio/${base}.${format}`;
}
