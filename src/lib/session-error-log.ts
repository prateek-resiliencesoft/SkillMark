/**
 * Per-session error log: shared types + pure helpers (safe for client and server).
 * Never put API keys in entries — only the key source ("org"/"env") and slot.
 */

export const ERROR_CATEGORIES = ["ai", "rate_limit", "voice", "tts_stt", "report", "client", "anti_cheat", "other"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
export const ERROR_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  ai: "AI / API error",
  rate_limit: "API rate limit (429)",
  voice: "Voice relay",
  tts_stt: "Speech (TTS / STT)",
  report: "Report generation",
  client: "Browser / client error",
  anti_cheat: "Anti-cheating",
  other: "Other",
};

export interface SessionErrorEntry {
  id?: string;
  sessionId: string;
  createdAt?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  source: string;
  message: string;
  status?: number | null;
  code?: string | null;
  context?: Record<string, unknown>;
}

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google / Gemini
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /nvapi-[A-Za-z0-9_-]{16,}/g,
  /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi,
  /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi,
];

/** Strip anything that looks like a credential and cap length. */
export function redactSecrets(text: unknown, max = 1000): string {
  let s = typeof text === "string" ? text : text instanceof Error ? text.message : String(text ?? "");
  for (const re of SECRET_PATTERNS) {
    s = s.replace(re, (_m, prefix?: string) => (typeof prefix === "string" && prefix ? `${prefix}[redacted]` : "[redacted]"));
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const SECRET_KEY_NAMES = /^(api_?key|key|apikey|token|secret|password|authorization)$/i;

/** Redact a context object: drops key-like fields, redacts strings, bounds size. */
export function sanitizeContext(ctx: unknown, depth = 0): Record<string, unknown> {
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx as Record<string, unknown>).slice(0, 25)) {
    if (SECRET_KEY_NAMES.test(k)) continue;
    if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = redactSecrets(v, 500);
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === "string" ? redactSecrets(x, 200) : typeof x === "number" || typeof x === "boolean" ? x : null));
    else if (typeof v === "object" && depth < 2) out[k] = sanitizeContext(v, depth + 1);
  }
  return out;
}

/** HTTP-ish status from an SDK error, if any. */
export function errorStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown; message?: string } | null;
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  const m = /\b(4\d\d|5\d\d)\b/.exec(e?.message ?? "");
  return m ? Number(m[1]) : undefined;
}

export function isRateLimitError(err: unknown): boolean {
  if (errorStatus(err) === 429) return true;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : (err as { message?: string })?.message ?? "";
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg);
}

/** Build a normalized entry from a thrown error (category auto-promoted to rate_limit on 429). */
export function entryFromError(
  sessionId: string,
  err: unknown,
  opts: { category: ErrorCategory; source: string; severity?: ErrorSeverity; context?: Record<string, unknown> },
): SessionErrorEntry {
  const rate = isRateLimitError(err);
  const status = errorStatus(err) ?? (rate ? 429 : undefined);
  const rawCode = (err as { code?: unknown })?.code;
  const code = rate && /RESOURCE_EXHAUSTED/.test(String((err as Error)?.message ?? "")) ? "RESOURCE_EXHAUSTED" : typeof rawCode === "string" ? rawCode : rate ? "RATE_LIMITED" : undefined;
  return {
    sessionId,
    category: rate && (opts.category === "ai" || opts.category === "voice" || opts.category === "report") ? "rate_limit" : opts.category,
    severity: opts.severity ?? "error",
    source: opts.source,
    message: redactSecrets(err),
    status: status ?? null,
    code: code ?? null,
    context: sanitizeContext({ ...(opts.context ?? {}), ...(rate ? { originalCategory: opts.category } : {}) }),
  };
}

export interface ErrorLogSummary {
  total: number;
  byCategory: Partial<Record<ErrorCategory, number>>;
  bySeverity: Partial<Record<ErrorSeverity, number>>;
  rateLimitHits: number;
  failovers: number;
  envKeyUsed: number;
  firstAt: string | null;
  lastAt: string | null;
  impact: "none" | "low" | "medium" | "high";
  impactNote: string;
}

export function summarizeErrorLog(entries: Pick<SessionErrorEntry, "category" | "severity" | "createdAt" | "context">[]): ErrorLogSummary {
  const byCategory: ErrorLogSummary["byCategory"] = {};
  const bySeverity: ErrorLogSummary["bySeverity"] = {};
  let failovers = 0;
  let envKeyUsed = 0;
  const times: string[] = [];
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    if (e.context?.failover === true) failovers++;
    if (e.context?.keySource === "env") envKeyUsed++;
    if (e.createdAt) times.push(e.createdAt);
  }
  times.sort();
  const crit = bySeverity.critical ?? 0;
  const errs = bySeverity.error ?? 0;
  const rateLimitHits = byCategory.rate_limit ?? 0;
  let impact: ErrorLogSummary["impact"] = "none";
  let impactNote = "No errors were recorded during this interview.";
  if (entries.length) {
    if (crit > 0) {
      impact = "high";
      impactNote = "At least one failure interrupted the interview (e.g. all AI keys exhausted or voice could not reconnect). Results may be incomplete.";
    } else if (errs >= 3 || rateLimitHits >= 3) {
      impact = "medium";
      impactNote = "Several errors occurred; the candidate likely noticed delays or retries.";
    } else {
      impact = "low";
      impactNote = "Minor issues were recovered automatically (retry / key failover).";
    }
  }
  return {
    total: entries.length,
    byCategory,
    bySeverity,
    rateLimitHits,
    failovers,
    envKeyUsed,
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
    impact,
    impactNote,
  };
}

/** CSV export of entries (no secrets — entries are already sanitized). */
export function errorLogToCsv(entries: SessionErrorEntry[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["time", "category", "severity", "source", "status", "code", "message", "context"];
  const rows = entries.map((e) => [e.createdAt, e.category, e.severity, e.source, e.status, e.code, e.message, e.context ?? {}].map(esc).join(","));
  return [head.join(","), ...rows].join("\n");
}

/** In-memory limiter for anonymous client error reports: per session, 30/min and 300 total. */
export function createClientErrorLimiter(perMinute = 30, total = 300) {
  const hits = new Map<string, { windowStart: number; inWindow: number; total: number }>();
  return (sessionId: string, now = Date.now()): boolean => {
    let h = hits.get(sessionId);
    if (!h) {
      if (hits.size > 5000) hits.clear();
      h = { windowStart: now, inWindow: 0, total: 0 };
      hits.set(sessionId, h);
    }
    if (now - h.windowStart > 60_000) {
      h.windowStart = now;
      h.inWindow = 0;
    }
    if (h.inWindow >= perMinute || h.total >= total) return false;
    h.inWindow++;
    h.total++;
    return true;
  };
}
