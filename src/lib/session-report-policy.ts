/**
 * Pure rules for automatic report generation (no server imports, unit-tested).
 * The server runner lives in session-report-server.ts.
 */
import { MIN_ASSISTANT_LINES } from "@/lib/transcript/capture-check";

export type ReportStatus = "PENDING" | "GENERATING" | "READY" | "FAILED" | "SKIPPED";

/** Automatic attempts before we stop retrying (manual button still works). */
export const MAX_REPORT_ATTEMPTS = 3;
/** A GENERATING lock older than this is treated as dead (process restarted). */
export const REPORT_LOCK_STALE_MS = 10 * 60 * 1000;
/** Wait after a normal completion so the last transcript batch lands first. */
export const REPORT_DELAY_AFTER_COMPLETE_MS = 15_000;
/** Wait after an abandon so a late completion / transcript flush can arrive. */
export const REPORT_DELAY_AFTER_ABANDON_MS = 90_000;
/** Background pick-up cadence and look-back window. */
export const REPORT_SWEEP_INTERVAL_MS = 2 * 60 * 1000;
export const REPORT_SWEEP_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

export function retryDelayMs(attempt: number): number {
  // attempt is the number of attempts already made (1 → 30s, 2 → 2min).
  return attempt <= 1 ? 30_000 : 120_000;
}

export type ReportSessionState = {
  status: string;
  summary?: string | null;
  insights?: unknown;
  reportStatus?: string | null;
  reportAttempts?: number | null;
  reportStartedAt?: string | null;
};

/** A report (or a capture-failure notice that replaces it) already exists. */
export function hasReport(s: Pick<ReportSessionState, "summary" | "insights">): boolean {
  if (typeof s.summary === "string" && s.summary.trim().length > 0) return true;
  const ins = s.insights as { captureFailure?: unknown } | null | undefined;
  return !!(ins && typeof ins === "object" && ins.captureFailure);
}

export function isEndedStatus(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "ABANDONED";
}

/** True when another worker currently owns generation. */
export function isLockHeld(s: ReportSessionState, nowMs: number): boolean {
  if (s.reportStatus !== "GENERATING") return false;
  if (!s.reportStartedAt) return false;
  return nowMs - new Date(s.reportStartedAt).getTime() < REPORT_LOCK_STALE_MS;
}

export type ContentStats = { candidateWords: number; assistantLines: number; hasArtifacts: boolean };

export function contentStats(
  messages: { role: string; content?: string | null; contentType?: string | null }[],
): ContentStats {
  let candidateWords = 0;
  let assistantLines = 0;
  let hasArtifacts = false;
  for (const m of messages) {
    const type = (m.contentType ?? "TEXT").toUpperCase();
    if (type === "WHITEBOARD" || type === "CODE") {
      hasArtifacts = true;
      continue;
    }
    if (type !== "TEXT") continue;
    const role = String(m.role).toLowerCase();
    const text = (m.content ?? "").trim();
    if (role === "user") candidateWords += text ? text.split(/\s+/).length : 0;
    else if (role === "assistant") assistantLines += 1;
  }
  return { candidateWords, assistantLines, hasArtifacts };
}

export type ReportDecision =
  | { action: "generate" }
  | { action: "skip"; reason: "not_ended" | "has_report" | "no_content" | "busy" | "gave_up" };

/**
 * Decide whether an automatic report should run now.
 *  - Only ended sessions (COMPLETED / ABANDONED); DISQUALIFIED and live ones are left alone.
 *  - Never twice: an existing report or a live lock wins.
 *  - A session that left early with no candidate answers is skipped, unless the
 *    interviewer asked several questions (then the capture-failure check runs,
 *    so lost answers are flagged instead of silently ignored).
 */
export function decideReport(
  s: ReportSessionState,
  stats: ContentStats | null,
  nowMs: number,
  opts: { force?: boolean } = {},
): ReportDecision {
  if (!isEndedStatus(s.status)) return { action: "skip", reason: "not_ended" };
  if (!opts.force && hasReport(s)) return { action: "skip", reason: "has_report" };
  if (isLockHeld(s, nowMs)) return { action: "skip", reason: "busy" };
  if (!opts.force && s.reportStatus === "FAILED" && (s.reportAttempts ?? 0) >= MAX_REPORT_ATTEMPTS) {
    return { action: "skip", reason: "gave_up" };
  }
  if (!opts.force && s.reportStatus === "SKIPPED" && s.status === "ABANDONED") {
    return { action: "skip", reason: "no_content" };
  }
  if (stats) {
    const nothing = stats.candidateWords === 0 && !stats.hasArtifacts;
    if (nothing && stats.assistantLines === 0) return { action: "skip", reason: "no_content" };
    if (nothing && s.status === "ABANDONED" && stats.assistantLines < MIN_ASSISTANT_LINES) {
      return { action: "skip", reason: "no_content" };
    }
  }
  return { action: "generate" };
}

/** One report run may not hang forever (an AI call with no reply keeps the lock). */
export const REPORT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export function withReportTimeout<T>(work: Promise<T>, ms = REPORT_RUN_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Report generation timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** PENDING with no worker picking it up for this long counts as stuck. */
export const REPORT_PENDING_STUCK_MS = 15 * 60 * 1000;

/**
 * The results page should stop showing "Generating report…" and offer the
 * button again: the GENERATING lock is dead, or PENDING was never picked up.
 */
export function isReportStuck(
  s: { reportStatus?: string | null; reportStartedAt?: string | null; completedAt?: string | null },
  nowMs: number,
): boolean {
  const age = (iso?: string | null) => (iso ? nowMs - new Date(iso).getTime() : NaN);
  if (s.reportStatus === "GENERATING") {
    const a = age(s.reportStartedAt);
    return Number.isFinite(a) && a >= REPORT_LOCK_STALE_MS;
  }
  if (s.reportStatus === "PENDING") {
    const a = age(s.completedAt);
    return Number.isFinite(a) && a >= REPORT_PENDING_STUCK_MS;
  }
  return false;
}

/** Whether a completion request may (re)mark the session COMPLETED. */
export function canMarkCompleted(status: string | null | undefined): boolean {
  // COMPLETED is terminal (no re-run); DISQUALIFIED is never overridden.
  // ABANDONED → COMPLETED is allowed only inside the late-write grace window
  // (candidateWriteWindow): the tab-close beacon raced the final save.
  return status === "IN_PROGRESS" || status === "ABANDONED";
}

/** No saved activity / heartbeat for this long → a session with content is over. */
export const IDLE_SESSION_MS = 30 * 60 * 1000;
/** Opened the link, no heartbeat and no messages: over sooner. */
export const EMPTY_SESSION_IDLE_MS = 15 * 60 * 1000;
/** Set on sessions closed before the first question; the panel shows a note for it. */
export const NEVER_STARTED_END_REASON = "NEVER_STARTED";

export type IdleCloseInput = {
  nowMs: number;
  messageCount: number;
  hasHeartbeat: boolean;
  /** Reached the interviewer's goodbye (only meaningful with messages). */
  finished: boolean;
  /** Any activity times: heartbeat, last message, last activity, preflight events, startedAt, createdAt. */
  times: (string | null | undefined)[];
};

export type IdleCloseDecision =
  | { action: "wait" }
  | { action: "abandon_empty"; endIso: string; lastSeenMs: number }
  | { action: "close"; status: "COMPLETED" | "ABANDONED"; endIso: string; lastSeenMs: number };

/**
 * What to do with a quiet IN_PROGRESS session. Idle is measured from the latest
 * of all activity times (COALESCE of heartbeat, last message, activity,
 * startedAt, createdAt). Empty sessions (no messages, no heartbeat) end after
 * 15 min as ABANDONED with no report; sessions with content after 30 min.
 */
export function idleCloseDecision(i: IdleCloseInput): IdleCloseDecision {
  const seen = i.times.map((t) => (t ? new Date(t).getTime() : NaN)).filter((v) => Number.isFinite(v));
  if (!seen.length) return { action: "wait" };
  const lastSeenMs = Math.max(...seen);
  const empty = i.messageCount === 0 && !i.hasHeartbeat;
  const limit = empty ? EMPTY_SESSION_IDLE_MS : IDLE_SESSION_MS;
  if (i.nowMs - lastSeenMs < limit) return { action: "wait" };
  const endIso = new Date(lastSeenMs).toISOString();
  if (i.messageCount === 0) return { action: "abandon_empty", endIso, lastSeenMs };
  return { action: "close", status: i.finished ? "COMPLETED" : "ABANDONED", endIso, lastSeenMs };
}
