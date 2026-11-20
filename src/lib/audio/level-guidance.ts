import { classifyWithHysteresis, type LevelBand } from "./level-math";
import { LEVEL_CONFIG, type LevelConfig } from "./level-thresholds";

/** What the audio source looks like right now (derived by the hook from the shared MediaStream). */
export type MicState = "live" | "muted" | "disconnected" | "no-permission" | "idle";
export type MicStatus = "good" | "quiet" | "loud" | "muted" | "disconnected" | "no-permission" | "idle";
export type MicTone = "green" | "yellow" | "red" | "neutral";
export type MicWarning = "too-quiet" | "too-loud" | "muted" | "disconnected" | "no-permission";

export interface GuidanceInput {
  /** Monotonic ms (performance.now / rAF timestamp). */
  now: number;
  micState: MicState;
  /** RMS level of the frame, dBFS (finite). */
  db: number;
  /** Sample peak of the frame, dBFS (finite). */
  peakDb: number;
  /** True only while the candidate is expected to answer (not while the AI talks/thinks). */
  expectSpeaking: boolean;
}

export interface GuidanceState {
  status: MicStatus;
  tone: MicTone;
  warning: MicWarning | null;
  /** Warning text, or the "good" text while healthy; null when there is nothing to say. */
  message: string | null;
  /** Candidate's turn and nothing but silence for a long time (subtle hint only, never a banner). */
  noSignal: boolean;
}

interface Sample {
  t: number;
  db: number;
  peakDb: number;
}

const BAND_STATUS: Record<LevelBand, { status: MicStatus; tone: MicTone }> = {
  tooQuiet: { status: "quiet", tone: "red" },
  quiet: { status: "quiet", tone: "yellow" },
  good: { status: "good", tone: "green" },
  loud: { status: "loud", tone: "yellow" },
  clipping: { status: "loud", tone: "red" },
};

const NON_LIVE: Record<Exclude<MicState, "live">, GuidanceState> = {
  muted: { status: "muted", tone: "red", warning: "muted", message: LEVEL_CONFIG.messages.muted, noSignal: false },
  disconnected: {
    status: "disconnected",
    tone: "red",
    warning: "disconnected",
    message: LEVEL_CONFIG.messages.disconnected,
    noSignal: false,
  },
  "no-permission": {
    status: "no-permission",
    tone: "red",
    warning: "no-permission",
    message: LEVEL_CONFIG.messages.noPermission,
    noSignal: false,
  },
  idle: { status: "idle", tone: "neutral", warning: null, message: null, noSignal: false },
};

export const IDLE_GUIDANCE: GuidanceState = NON_LIVE.idle;

export function percentile(values: number[], p: number): number {
  if (!values.length) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
}

/**
 * Pure, time-driven guidance state machine (no DOM, no timers: caller supplies `now`).
 * Warnings only count samples taken while the candidate is expected to speak, so
 * the AI's own turn, normal pauses and background silence never nag.
 */
export class LevelGuidance {
  private samples: Sample[] = [];
  private expectSince: number | null = null;
  private lastT: number | null = null;
  private lastEval = -Infinity;
  private band: LevelBand | null = null;
  private quietWarn = false;
  private loudWarn = false;
  private state: GuidanceState = IDLE_GUIDANCE;

  constructor(private cfg: LevelConfig = LEVEL_CONFIG) {}

  reset() {
    this.samples = [];
    this.expectSince = null;
    this.lastT = null;
    this.lastEval = -Infinity;
    this.band = null;
    this.quietWarn = false;
    this.loudWarn = false;
  }

  update(input: GuidanceInput): GuidanceState {
    const { cfg } = this;
    const { now } = input;

    if (input.micState !== "live") {
      this.reset();
      this.state = NON_LIVE[input.micState];
      return this.state;
    }

    if (this.lastT != null && now - this.lastT > cfg.gapResetMs) this.reset(); // background tab etc.
    this.lastT = now;

    if (input.expectSpeaking) {
      if (this.expectSince == null) this.expectSince = now;
    } else {
      this.expectSince = null;
      this.quietWarn = false;
      this.loudWarn = false;
    }

    this.samples.push({ t: now, db: input.db, peakDb: input.peakDb });
    const keep = Math.max(cfg.lowSustainMs, cfg.noSignalMs, cfg.statusWindowMs) + 500;
    while (this.samples.length && this.samples[0].t < now - keep) this.samples.shift();

    if (now - this.lastEval < cfg.evalIntervalMs) return this.state;
    this.lastEval = now;
    this.state = this.evaluate(now);
    return this.state;
  }

  /** Samples from the last `ms`, but never from before the candidate's turn began. */
  private window(now: number, ms: number): Sample[] {
    const from = Math.max(now - ms, this.expectSince ?? Infinity);
    return this.samples.filter((s) => s.t >= from);
  }

  private spanOk(now: number, ms: number): boolean {
    return this.expectSince != null && now - this.expectSince >= ms;
  }

  private isLoud(s: Sample): boolean {
    return s.db >= this.cfg.loudBelowDb || s.peakDb >= this.cfg.clipPeakDb;
  }

  private evaluate(now: number): GuidanceState {
    const { cfg } = this;
    const voiced = (frames: Sample[]) => frames.filter((s) => s.db > cfg.voiceActivityDb);

    // Status label: loudest level of the last couple of seconds (no flicker between sentences).
    let maxDb: number = cfg.floorDb;
    for (const s of this.samples) if (s.t >= now - cfg.statusWindowMs && s.db > maxDb) maxDb = s.db;
    this.band = classifyWithHysteresis(this.band, maxDb, cfg);

    if (this.expectSince != null) {
      // Too loud: sustained clipping / near-clip (a single peak never counts).
      if (!this.loudWarn) {
        if (this.spanOk(now, cfg.loudSustainMs)) {
          const v = voiced(this.window(now, cfg.loudSustainMs));
          if (v.length >= 3 && v.filter((s) => this.isLoud(s)).length / v.length >= cfg.loudFrameRatio) {
            this.loudWarn = true;
            this.quietWarn = false;
          }
        }
      } else {
        const v = voiced(this.window(now, cfg.recoverMs));
        if (!v.length || v.filter((s) => this.isLoud(s)).length / v.length < cfg.loudFrameRatio / 2) {
          this.loudWarn = false;
        }
      }

      // Too quiet: voice is present for ~4s but its level stays low.
      if (!this.loudWarn) {
        if (!this.quietWarn) {
          if (this.spanOk(now, cfg.lowSustainMs)) {
            const frames = this.window(now, cfg.lowSustainMs);
            const v = voiced(frames);
            if (
              frames.length &&
              v.length / frames.length >= cfg.minVoiceActivityRatio &&
              percentile(v.map((s) => s.db), cfg.speechPercentile) < cfg.quietBelowDb
            ) {
              this.quietWarn = true;
            }
          }
        } else {
          const v = voiced(this.window(now, cfg.recoverMs));
          if (v.length >= 3 && percentile(v.map((s) => s.db), 0.5) >= cfg.quietBelowDb) {
            this.quietWarn = false;
          }
        }
      }
    }

    const noSignal =
      this.spanOk(now, cfg.noSignalMs) && voiced(this.window(now, cfg.noSignalMs)).length === 0;

    let { status, tone } = BAND_STATUS[this.band];
    let warning: MicWarning | null = null;
    let message: string | null = status === "good" ? cfg.messages.good : null;
    if (this.loudWarn) {
      warning = "too-loud";
      status = "loud";
      tone = "red";
      message = cfg.messages.tooLoud;
    } else if (this.quietWarn) {
      warning = "too-quiet";
      status = "quiet";
      tone = "red";
      message = cfg.messages.tooQuiet;
    }
    return { status, tone, warning, message, noSignal };
  }
}
