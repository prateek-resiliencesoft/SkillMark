/**
 * Reading detection from horizontal iris position. Reading a line looks like a
 * slow drift one way followed by a fast return sweep the other way, repeated
 * in the same direction. Direction-agnostic (camera may be mirrored).
 * Weak signal on its own — only used as corroboration.
 */

export interface GazeSample {
  t: number;
  /** Horizontal iris offset within the eye, roughly -1..1. */
  x: number;
}

export interface ReadingThresholds {
  fastJump: number;
  fastMaxDtMs: number;
  minDrift: number;
  minDriftMs: number;
  maxDriftMs: number;
  /** net drift / path length: how monotonic the drift was. */
  minStraightness: number;
  windowMs: number;
  minSweeps: number;
  cooldownMs: number;
}

export const DEFAULT_READING_THRESHOLDS: ReadingThresholds = {
  fastJump: 0.3,
  fastMaxDtMs: 350,
  minDrift: 0.2,
  minDriftMs: 600,
  maxDriftMs: 3000,
  minStraightness: 0.6,
  windowMs: 10_000,
  minSweeps: 3,
  cooldownMs: 30_000,
};

/** Normalised iris x within the eye for MediaPipe's 478-point face mesh. */
export function gazeXFromLandmarks(lm: ArrayLike<{ x: number }>): number | null {
  if (lm.length < 478) return null;
  const ratio = (iris: number, a: number, b: number) => {
    const w = lm[b].x - lm[a].x;
    return Math.abs(w) < 1e-4 ? null : (lm[iris].x - lm[a].x) / w;
  };
  const r = ratio(468, 33, 133);
  const l = ratio(473, 362, 263);
  if (r === null || l === null) return null;
  return ((r + l) / 2 - 0.5) * 2;
}

export class ReadingPatternDetector {
  private buf: GazeSample[] = [];
  private sweeps: { t: number; sign: number }[] = [];
  private lastFiredAt = -Infinity;

  constructor(private t: ReadingThresholds = DEFAULT_READING_THRESHOLDS) {}

  /** Returns the sweep count when a reading pattern is detected. */
  update(s: GazeSample, speaking: boolean): number | null {
    const prev = this.buf[this.buf.length - 1];
    this.buf.push(s);
    const horizon = s.t - this.t.maxDriftMs - this.t.fastMaxDtMs;
    while (this.buf.length && this.buf[0].t < horizon) this.buf.shift();

    if (prev && speaking && s.t - prev.t <= this.t.fastMaxDtMs) {
      const jump = s.x - prev.x;
      if (Math.abs(jump) >= this.t.fastJump && this.isDriftBefore(prev, -Math.sign(jump))) {
        this.sweeps.push({ t: s.t, sign: Math.sign(jump) });
      }
    }

    this.sweeps = this.sweeps.filter((w) => s.t - w.t <= this.t.windowMs);
    const pos = this.sweeps.filter((w) => w.sign > 0).length;
    const count = Math.max(pos, this.sweeps.length - pos);
    if (count >= this.t.minSweeps && s.t - this.lastFiredAt >= this.t.cooldownMs) {
      this.lastFiredAt = s.t;
      this.sweeps = [];
      return count;
    }
    return null;
  }

  private isDriftBefore(end: GazeSample, dir: number): boolean {
    let span = this.buf.filter((g) => g.t <= end.t && end.t - g.t <= this.t.maxDriftMs);
    for (let i = span.length - 1; i > 0; i--) {
      if (Math.abs(span[i].x - span[i - 1].x) >= this.t.fastJump) {
        span = span.slice(i); // drift starts after the previous sweep
        break;
      }
    }
    if (span.length < 3) return false;
    const first = span[0];
    if (end.t - first.t < this.t.minDriftMs) return false;
    const net = end.x - first.x;
    if (net * dir < this.t.minDrift) return false;
    let path = 0;
    for (let i = 1; i < span.length; i++) path += Math.abs(span[i].x - span[i - 1].x);
    return path > 0 && Math.abs(net) / path >= this.t.minStraightness;
  }

  reset() {
    this.buf = [];
    this.sweeps = [];
  }
}
