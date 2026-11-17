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

const noisyOr = (xs: number[]) => 1 - xs.reduce((p, x) => p * (1 - Math.max(0, Math.min(1, x))), 1);

export interface IntegrityGroupAssessment {
  group: IntegrityGroup;
  label: string;
  level: number;
  reasons: string[];
}

export interface IntegrityAssessment {
  score: number;
  concern: "none" | "low" | "review";
  groups: IntegrityGroupAssessment[];
}

export function assessIntegrity(signals: IntegritySignal[], strikeLog: unknown[] = []): IntegrityAssessment {
  const parts = new Map<IntegrityGroup, { sev: number[]; reasons: string[] }>();
  const add = (g: IntegrityGroup, sev: number, reason: string) => {
    if (sev <= 0) return;
    const p = parts.get(g) ?? { sev: [], reasons: [] };
    p.sev.push(sev);
    p.reasons.push(reason);
    parts.set(g, p);
  };
  const of = (t: IntegritySignalType) => signals.filter((s) => s.type === t);

  for (const s of of("virtual_camera")) add("device", 0.7, `Virtual camera in use: ${s.detail ?? "unknown"}`);
  for (const s of of("virtual_microphone")) add("device", 0.7, `Virtual / loopback microphone in use: ${s.detail ?? "unknown"}`);
  for (const s of of("processing_device")) add("device", 0.1, `Audio/video processing device (often legitimate): ${s.detail ?? "unknown"}`);
  for (const s of of("device_changed")) add("device", 0.3, `Device characteristics changed: ${s.detail ?? ""}`.trim());

  const corr = of("av_correlation").map((s) => s.value ?? 1);
  if (corr.length) {
    const m = median(corr);
    const sev = correlationSeverity(m) * (corr.length >= 2 ? 1 : 0.6);
    add("audio_video", sev, `Low voice / lip-movement correlation (median r=${m.toFixed(2)} over ${corr.length} answer${corr.length > 1 ? "s" : ""})`);
  }
  for (const s of of("offscreen_voice")) add("audio_video", 0.6, s.detail ?? "Voice while mouth closed");

  for (const s of of("liveness")) {
    if (s.value === 0) add("liveness", 0.6, `Liveness check not completed: ${s.detail ?? ""}`.trim());
  }

  const lat = latencySeverity(of("response_latency").map((s) => s.value ?? 0));
  add("conversation", lat.severity, `Uniform answer start delay (median ${(lat.median / 1000).toFixed(1)}s, variation ${(lat.cv * 100).toFixed(0)}%)`);
  for (const s of of("reading_pattern")) add("conversation", 0.3, `Reading-like eye movement while answering (${s.value ?? "?"} line sweeps)`);

  for (const s of of("extension_injection")) {
    add("environment", s.value ?? 0.4, `Browser extension injected into the interview page: ${s.detail ?? "unknown"}`);
  }

  for (const v of strikeLog) {
    const m = STRIKE_GROUP[String((v as { type?: string })?.type)];
    if (m) add(m.group, m.severity, m.reason);
  }

  const groups: IntegrityGroupAssessment[] = [...parts.entries()].map(([group, p]) => ({
    group,
    label: GROUP_LABEL[group],
    level: Math.min(0.95, noisyOr(p.sev)),
    reasons: [...new Set(p.reasons)],
  }));
  groups.sort((a, b) => b.level - a.level);

  const elevated = groups.filter((g) => g.level >= 0.5).length;
  const concern = elevated >= 2 ? "review" : groups.some((g) => g.level >= 0.3) ? "low" : "none";
  const score = Math.max(0, Math.round(100 - groups.reduce((a, g) => a + g.level * 25, 0)));
  return { score, concern, groups };
}
