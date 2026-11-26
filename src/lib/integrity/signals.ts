/**
 * Silent integrity signals (never shown to the candidate, never strikes) and
 * the reviewer-facing assessment built from them. A single noisy group never
 * produces "needs review": that takes 2+ independent groups.
 */

export const INTEGRITY_SIGNAL_TYPES = [
  "virtual_camera",
  "virtual_microphone",
  "processing_device",
  "device_changed",
  "av_correlation",
  "offscreen_voice",
  "reading_pattern",
  "response_latency",
  "liveness",
  "extension_injection",
  "detector_unavailable",
] as const;

export type IntegritySignalType = (typeof INTEGRITY_SIGNAL_TYPES)[number];

export interface IntegritySignal {
  type: IntegritySignalType;
  timestamp: number;
  /** Type-specific: correlation, latency ms, sweep count, 1/0 pass, severity class. */
  value?: number;
  detail?: string;
}

export type IntegrityGroup = "device" | "audio_video" | "liveness" | "conversation" | "environment";

export const GROUP_LABEL: Record<IntegrityGroup, string> = {
  device: "Camera / microphone",
  audio_video: "Voice vs. lip movement",
  liveness: "Liveness checks",
  conversation: "Answer behaviour",
  environment: "Browser environment",
};

/** Strike-log entries (warn tier) that also feed the assessment. */
const STRIKE_GROUP: Record<string, { group: IntegrityGroup; severity: number; reason: string }> = {
  offscreen_voice: { group: "audio_video", severity: 0.9, reason: "Voice heard while the visible face's mouth was closed (strike)" },
  device_switch: { group: "device", severity: 0.5, reason: "Camera or microphone switched mid-interview (strike)" },
};

export const COPILOT_MARKERS = /cluely|final ?round|lockedin|locked-in|parakeet|verve|interview ?(copilot|coder|solver|sidekick)|sensei|aiapply|leetcode ?wizard|pluely|cheating/i;
const BENIGN_MARKERS = /grammarly|lastpass|1password|bitwarden|dashlane|honey|darkreader|dark-reader|loom|react-devtools|metamask|nextjs|next-route-announcer|google-translate|translate/i;

/** Severity class for an element / resource injected into the page by an extension. */
export function classifyInjectedMarker(marker: string): number {
  if (COPILOT_MARKERS.test(marker)) return 0.9;
  if (BENIGN_MARKERS.test(marker)) return 0.1;
  return 0.4;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Copilot pattern: a steady few-second delay before every answer regardless
 * of difficulty → typical delay with unusually low variance.
 */
export function latencySeverity(latenciesMs: number[]): { severity: number; median: number; cv: number } {
  const xs = latenciesMs.filter((x) => x > 0 && x < 30_000);
  const med = median(xs);
  if (xs.length < 4) return { severity: 0, median: med, cv: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const cv = mean ? sd / mean : 0;
  const inBand = med >= 1500 && med <= 7000;
  const severity = !inBand ? 0 : cv < 0.15 ? 0.75 : cv < 0.25 ? 0.55 : 0;
  return { severity, median: med, cv };
}

export function correlationSeverity(r: number): number {
  return r < 0.05 ? 0.8 : r < 0.15 ? 0.5 : 0;
}

/** Stored samples per signal type; 11 types × 180 stays under the old 2000-entry column budget. */
export const MAX_SIGNALS_PER_TYPE = 180;

/** True when a sample carries no concern on its own (safe to drop first when a type is full). */
export function isBenignSignal(s: IntegritySignal): boolean {
  switch (s.type) {
    case "liveness":
      return s.value !== 0;
    case "extension_injection":
      return (s.value ?? 0.4) < 0.4;
    case "av_correlation":
      return correlationSeverity(s.value ?? 1) === 0;
    case "processing_device":
    case "detector_unavailable":
    case "response_latency":
      return true;
    default:
      return false;
  }
}

/**
 * Append browser-reported signals without letting any batch evict earlier
 * detections: each type has its own cap, a full type drops its oldest benign
 * sample first, and a type full of detections keeps the earliest ones.
 */
export function mergeIntegritySignals(
  prev: IntegritySignal[],
  incoming: IntegritySignal[],
  perType = MAX_SIGNALS_PER_TYPE,
): IntegritySignal[] {
  const out = [...prev];
  const counts = new Map<string, number>();
  for (const s of out) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  for (const s of incoming) {
    const n = counts.get(s.type) ?? 0;
    if (n < perType) {
      out.push(s);
      counts.set(s.type, n + 1);
      continue;
    }
    const evict = out.findIndex((x) => x.type === s.type && isBenignSignal(x));
    if (evict < 0) continue;
    out.splice(evict, 1);
    out.push(s);
  }
  return out;
}

const noisyOr = (xs: number[]) => 1 - xs.reduce((p, x) => p * (1 - Math.max(0, Math.min(1, x))), 1);

/** A group is "elevated" at this level; "needs review" takes 2 elevated groups. */
export const REVIEW_LEVEL = 0.5;
export const LOW_LEVEL = 0.3;

export interface IntegrityFactor {
  key: string;
  label: string;
  /** 0..1, highest single occurrence. */
  confidence: number;
  count: number;
  examples: string[];
}

export interface IntegrityGroupAssessment {
  group: IntegrityGroup;
  label: string;
  level: number;
  signalCount: number;
  factors: IntegrityFactor[];
}

export interface IntegrityAssessment {
  score: number;
  concern: "none" | "low" | "review";
  groups: IntegrityGroupAssessment[];
  /** Raw silent-signal counts by type, for triage. */
  signalCounts: Record<string, number>;
  elevatedGroups: number;
}

/** Repeats of one factor add at most half its confidence once, so weak signals can't stack into "elevated". */
const factorContribution = (f: IntegrityFactor) =>
  f.count > 1 ? f.confidence + (1 - f.confidence) * f.confidence * 0.5 : f.confidence;

export function assessIntegrity(signals: IntegritySignal[], strikeLog: unknown[] = []): IntegrityAssessment {
  const parts = new Map<IntegrityGroup, Map<string, IntegrityFactor>>();
  const add = (g: IntegrityGroup, key: string, label: string, confidence: number, example?: string) => {
    if (confidence <= 0) return;
    const factors = parts.get(g) ?? new Map<string, IntegrityFactor>();
    const f = factors.get(key) ?? { key, label, confidence: 0, count: 0, examples: [] };
    f.confidence = Math.max(f.confidence, confidence);
    f.count++;
    if (example && f.examples.length < 3 && !f.examples.includes(example)) f.examples.push(example);
    factors.set(key, f);
    parts.set(g, factors);
  };
  const of = (t: IntegritySignalType) => signals.filter((s) => s.type === t);

  for (const s of of("virtual_camera")) add("device", "virtual_camera", "Virtual camera in use", 0.7, s.detail);
  for (const s of of("virtual_microphone")) add("device", "virtual_microphone", "Virtual / loopback microphone in use", 0.7, s.detail);
  for (const s of of("processing_device")) add("device", "processing_device", "Audio/video processing device (often legitimate)", 0.1, s.detail);
  for (const s of of("device_changed")) add("device", "device_changed", "Device characteristics changed", 0.3, s.detail);

  const corr = of("av_correlation").map((s) => s.value ?? 1);
  if (corr.length) {
    const m = median(corr);
    const conf = correlationSeverity(m) * (corr.length >= 2 ? 1 : 0.6);
    add("audio_video", "av_correlation", "Low voice / lip-movement correlation", conf, `median r=${m.toFixed(2)} over ${corr.length} answer${corr.length > 1 ? "s" : ""}`);
  }

  for (const s of of("liveness")) {
    if (s.value === 0) add("liveness", "liveness_failed", "Liveness check not completed", 0.6, s.detail);
  }

  const lat = latencySeverity(of("response_latency").map((s) => s.value ?? 0));
  add("conversation", "uniform_latency", "Uniform answer start delay", lat.severity, `median ${(lat.median / 1000).toFixed(1)}s, variation ${(lat.cv * 100).toFixed(0)}%`);
  for (const s of of("reading_pattern")) add("conversation", "reading_pattern", "Reading-like eye movement while answering", 0.3, `${s.value ?? "?"} line sweeps`);

  for (const s of of("extension_injection")) {
    const c = s.value ?? 0.4;
    const kind = c >= 0.9 ? "known AI-assistant extension" : c >= 0.4 ? "unknown extension" : "common extension";
    add("environment", `extension_${kind}`, `Browser extension injected into the page (${kind})`, c, s.detail);
  }

  for (const v of strikeLog) {
    const type = String((v as { type?: string })?.type);
    const m = STRIKE_GROUP[type];
    if (m) add(m.group, `strike_${type}`, m.reason, m.severity, (v as { detail?: string }).detail);
  }

  const groups: IntegrityGroupAssessment[] = [...parts.entries()].map(([group, factorMap]) => {
    const factors = [...factorMap.values()].sort((a, b) => b.confidence - a.confidence);
    return {
      group,
      label: GROUP_LABEL[group],
      level: Math.min(0.95, noisyOr(factors.map(factorContribution))),
      signalCount: factors.reduce((a, f) => a + f.count, 0),
      factors,
    };
  });
  groups.sort((a, b) => b.level - a.level);

  const signalCounts: Record<string, number> = {};
  for (const s of signals) signalCounts[s.type] = (signalCounts[s.type] ?? 0) + 1;

  const elevatedGroups = groups.filter((g) => g.level >= REVIEW_LEVEL).length;
  const concern = elevatedGroups >= 2 ? "review" : groups.some((g) => g.level >= LOW_LEVEL) ? "low" : "none";
  const score = Math.max(0, Math.round(100 - groups.reduce((a, g) => a + g.level * 25, 0)));
  return { score, concern, groups, signalCounts, elevatedGroups };
}
