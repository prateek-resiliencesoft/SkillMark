/**
 * Lip-sync checks: mic loudness vs the candidate's mouth opening (MediaPipe
 * `jawOpen` blendshape), sampled together ~5x per second.
 *
 * - offscreen voice: sustained speech while the only visible face keeps its
 *   mouth closed → someone else is talking (warn tier).
 * - segment correlation: per candidate answer, how well loudness follows
 *   mouth movement (silent signal; low = dubbed / other speaker / synthetic).
 */

export interface AvSample {
  t: number;
  rms: number;
  jawOpen: number | null;
  faces: number;
  /** AI audio playing (its echo is not the candidate). */
  aiSpeaking: boolean;
}

export interface AvThresholds {
  closedJaw: number;
  offscreenHoldMs: number;
  /** Speech pauses shorter than this don't break an offscreen streak. */
  gapMs: number;
  cooldownMs: number;
  minSpeechRms: number;
  floorRatio: number;
  minSegmentSamples: number;
  maxSegmentSamples: number;
  minSpeechRatio: number;
}

export const DEFAULT_AV_THRESHOLDS: AvThresholds = {
  closedJaw: 0.05,
  offscreenHoldMs: 5000,
  gapMs: 700,
  cooldownMs: 30_000,
  minSpeechRms: 0.012,
  floorRatio: 3,
  minSegmentSamples: 40, // ~8s
  maxSegmentSamples: 300, // ~60s: chat mode has no AI-speech boundaries
  minSpeechRatio: 0.3,
};

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Adaptive noise floor: drops fast, rises slowly. */
export class SpeechGate {
  private floor: number | null = null;
  constructor(private t: Pick<AvThresholds, "minSpeechRms" | "floorRatio"> = DEFAULT_AV_THRESHOLDS) {}
  update(rms: number): boolean {
    if (this.floor === null) this.floor = rms;
    else if (rms < this.floor) this.floor = (this.floor + rms) / 2;
    else this.floor += (rms - this.floor) * 0.005;
    return rms >= Math.max(this.t.minSpeechRms, this.floor * this.t.floorRatio);
  }
}

export interface AvSegmentResult {
  correlation: number;
  samples: number;
  speechRatio: number;
}

export interface AvUpdate {
  offscreenVoiceMs?: number;
  segment?: AvSegmentResult;
}

export class AvSyncMonitor {
  private gate: SpeechGate;
  private badSince: number | null = null;
  private lastBadAt = 0;
  private lastFiredAt = -Infinity;
  private wasAiSpeaking = false;
  private rmsSeg: number[] = [];
  private jawSeg: number[] = [];
  private speechSeg = 0;
  /** Speech gate result of the last update. */
  speaking = false;

  constructor(private t: AvThresholds = DEFAULT_AV_THRESHOLDS) {
    this.gate = new SpeechGate(t);
  }

  update(s: AvSample): AvUpdate {
    const out: AvUpdate = {};
    const speech = this.gate.update(s.rms);
    this.speaking = speech;

    if (s.aiSpeaking && !this.wasAiSpeaking) {
      const seg = this.flush();
      if (seg) out.segment = seg;
    }
    this.wasAiSpeaking = s.aiSpeaking;

    const oneFace = s.faces === 1 && s.jawOpen !== null;
    const bad = speech && oneFace && !s.aiSpeaking && (s.jawOpen as number) < this.t.closedJaw;
    if (bad) {
      if (this.badSince === null) this.badSince = s.t;
      this.lastBadAt = s.t;
      if (s.t - this.badSince >= this.t.offscreenHoldMs && s.t - this.lastFiredAt >= this.t.cooldownMs) {
        out.offscreenVoiceMs = s.t - this.badSince;
        this.lastFiredAt = s.t;
        this.badSince = null;
      }
    } else if (this.badSince !== null && s.t - this.lastBadAt > this.t.gapMs) {
      this.badSince = null;
    }

    if (oneFace && !s.aiSpeaking) {
      this.rmsSeg.push(s.rms);
      this.jawSeg.push(s.jawOpen as number);
      if (speech) this.speechSeg++;
      if (this.rmsSeg.length >= this.t.maxSegmentSamples) {
        const seg = this.flush();
        if (seg) out.segment = seg;
      }
    }
    return out;
  }

  /** Close the current answer segment; null when too short / mostly silent. */
  flush(): AvSegmentResult | null {
    const samples = this.rmsSeg.length;
    const speechRatio = samples ? this.speechSeg / samples : 0;
    const result =
      samples >= this.t.minSegmentSamples && speechRatio >= this.t.minSpeechRatio
        ? { correlation: pearson(this.rmsSeg, this.jawSeg), samples, speechRatio }
        : null;
    this.rmsSeg = [];
    this.jawSeg = [];
    this.speechSeg = 0;
    return result;
  }

  reset() {
    this.badSince = null;
    this.flush();
  }
}
