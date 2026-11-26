export const PLAYBACK_SAMPLE_RATE = 24_000;
export const JITTER_BUFFER_TARGET_MS = 200;
export const JITTER_BUFFER_LOW_WATER_MS = 120;
export const JITTER_BUFFER_MAX_WAIT_MS = 250;
export const JITTER_BUFFER_MAX_BATCH_MS = 260;

export interface PlaybackFlushDecision {
  queuedSamples: number;
  bufferedAheadMs: number;
  firstChunkQueuedAtMs: number | null;
  nowMs: number;
  sampleRate?: number;
  /** Pre-roll to build before (re)starting playback; grows after underruns. */
  targetMs?: number;
}

/** Largest adaptive pre-roll after repeated underruns (choppy network). */
export const JITTER_BUFFER_ADAPTIVE_MAX_MS = 450;
/** Pre-roll added after each underrun within a session. */
export const JITTER_BUFFER_UNDERRUN_STEP_MS = 60;

/** Next pre-roll target after an underrun (gaps in the AI's voice). */
export function nextJitterTargetMs(currentMs: number): number {
  return Math.min(JITTER_BUFFER_ADAPTIVE_MAX_MS, Math.max(JITTER_BUFFER_TARGET_MS, currentMs) + JITTER_BUFFER_UNDERRUN_STEP_MS);
}

export function samplesToDurationMs(
  sampleCount: number,
  sampleRate = PLAYBACK_SAMPLE_RATE,
): number {
  if (sampleCount <= 0 || sampleRate <= 0) return 0;
  return (sampleCount / sampleRate) * 1000;
}

export function shouldFlushPlaybackQueue({
  queuedSamples,
  bufferedAheadMs,
  firstChunkQueuedAtMs,
  nowMs,
  sampleRate = PLAYBACK_SAMPLE_RATE,
  targetMs = JITTER_BUFFER_TARGET_MS,
}: PlaybackFlushDecision): boolean {
  if (queuedSamples <= 0) return false;

  const queuedMs = samplesToDurationMs(queuedSamples, sampleRate);
  const waitMs =
    typeof firstChunkQueuedAtMs === "number"
      ? Math.max(0, nowMs - firstChunkQueuedAtMs)
      : 0;

  // Already playing: append right away so chunks stay back-to-back (holding
  // them while the buffer drains is what caused audible gaps).
  if (bufferedAheadMs > JITTER_BUFFER_LOW_WATER_MS) return true;
  // Cold start / underrun: build up a small cushion first.
  if (queuedMs >= targetMs) return true;
  // Waited long enough: play what we have (stream may be ending).
  if (waitMs >= Math.max(JITTER_BUFFER_MAX_WAIT_MS, targetMs + 50)) return true;

  return false;
}
