import { LEVEL_CONFIG, type LevelConfig } from "./level-thresholds";

export type LevelBand = "tooQuiet" | "quiet" | "good" | "loud" | "clipping";

const BAND_ORDER: LevelBand[] = ["tooQuiet", "quiet", "good", "loud", "clipping"];

/** Clamp to a finite dBFS value in [floorDb, 0+]. Never NaN / ±Infinity. */
export function clampDb(db: number, cfg: Pick<LevelConfig, "floorDb"> = LEVEL_CONFIG): number {
  if (!Number.isFinite(db)) return db > 0 ? 0 : cfg.floorDb;
  return Math.max(cfg.floorDb, db);
}

/** RMS (linear, 0..1) -> dBFS = 20*log10(rms), floored. Silence/NaN -> floorDb. */
export function rmsToDbfs(rms: number, cfg: Pick<LevelConfig, "floorDb"> = LEVEL_CONFIG): number {
  if (!(rms > 1e-8)) return cfg.floorDb; // 0, negative, NaN
  return clampDb(20 * Math.log10(rms), cfg);
}

/** RMS and sample peak of a time-domain buffer (float -1..1). */
export function measureBuffer(buf: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return { rms: buf.length ? Math.sqrt(sum / buf.length) : 0, peak };
}

/** Band for a level; a boundary value belongs to the higher band. */
export function classifyLevel(db: number, cfg: LevelConfig = LEVEL_CONFIG): LevelBand {
  const v = clampDb(db, cfg);
  if (v < cfg.tooQuietBelowDb) return "tooQuiet";
  if (v < cfg.quietBelowDb) return "quiet";
  if (v < cfg.goodBelowDb) return "good";
  if (v < cfg.loudBelowDb) return "loud";
  return "clipping";
}

/** Like classifyLevel but sticks to `prev` unless the level crossed the boundary by hysteresisDb. */
export function classifyWithHysteresis(
  prev: LevelBand | null,
  db: number,
  cfg: LevelConfig = LEVEL_CONFIG,
): LevelBand {
  const next = classifyLevel(db, cfg);
  if (!prev || prev === next) return next;
  const h = cfg.hysteresisDb;
  const rising = BAND_ORDER.indexOf(next) > BAND_ORDER.indexOf(prev);
  // Re-classify with the level nudged back toward `prev`: only a decisive crossing changes band.
  return classifyLevel(rising ? db - h : db + h, cfg) === prev ? prev : next;
}

/** dB -> 0..1 position on the meter scale. */
export function dbToFraction(db: number, cfg: LevelConfig = LEVEL_CONFIG): number {
  const span = cfg.scaleMaxDb - cfg.scaleMinDb;
  const f = (clampDb(db, cfg) - cfg.scaleMinDb) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Text for the dB readout; always finite ("-90" at the floor). */
export function formatDb(db: number, cfg: LevelConfig = LEVEL_CONFIG): string {
  return String(Math.round(clampDb(db, cfg)));
}

/** Fast attack (one-pole), linear-in-dB release. */
export class Ballistics {
  private value: number;
  constructor(private cfg: LevelConfig = LEVEL_CONFIG) {
    this.value = cfg.floorDb;
  }
  update(db: number, dtMs: number): number {
    const target = clampDb(db, this.cfg);
    const dt = Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
    if (target > this.value) {
      this.value += (target - this.value) * (1 - Math.exp(-dt / this.cfg.attackTauMs));
    } else {
      this.value = Math.max(target, this.value - (this.cfg.releaseDbPerSec * dt) / 1000);
    }
    return this.value;
  }
  reset() {
    this.value = this.cfg.floorDb;
  }
}

/** Holds the recent maximum for peakHoldMs, then decays toward the live level. */
export class PeakHold {
  private peak: number;
  private holdUntil = 0;
  private last: number | null = null;
  constructor(private cfg: LevelConfig = LEVEL_CONFIG) {
    this.peak = cfg.floorDb;
  }
  update(db: number, now: number): number {
    const v = clampDb(db, this.cfg);
    const dt = this.last == null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    if (v >= this.peak) {
      this.peak = v;
      this.holdUntil = now + this.cfg.peakHoldMs;
    } else if (now > this.holdUntil) {
      this.peak = Math.max(v, this.peak - (this.cfg.peakDecayDbPerSec * dt) / 1000);
    }
    return this.peak;
  }
  reset() {
    this.peak = this.cfg.floorDb;
    this.holdUntil = 0;
    this.last = null;
  }
}
