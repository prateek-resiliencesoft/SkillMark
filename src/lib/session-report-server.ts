/**
 * Automatic session reports. Server-only.
 *
 * Runs right after a session ends (complete, abandon with content) and from a
 * background sweep that picks up ended sessions that still have no report.
 * Idempotent: a GENERATING lock (claimed with a conditional update) stops
 * double generation; failures retry a few times, then the manual button is the
 * fallback. Works without migration 28 too (no lock, best effort).
 */
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSummaryForSession } from "@/lib/session-summary";
import { recordSessionError } from "@/lib/session-error-log-server";
import {
  MAX_REPORT_ATTEMPTS,
  REPORT_LOCK_STALE_MS,
  REPORT_SWEEP_LOOKBACK_MS,
  contentStats,
  decideReport,
  hasReport,
  retryDelayMs,
  type ReportSessionState,
  type ReportStatus,
} from "@/lib/session-report-policy";
import { effectiveDurationSeconds, lastMessageAt, reachedClosing } from "@/lib/session-activity";

const log = createLogger("session-report");

type Row = ReportSessionState & { id: string };

let reportColumnsMissing = false;

function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /reportStatus|reportAttempts|reportStartedAt|reportError/.test(error.message ?? "")
  );
}

async function loadState(sessionId: string): Promise<Row | null> {
  if (!reportColumnsMissing) {
    const { data, error } = await supabaseAdmin
      .from("sessions")
      .select('id, status, summary, insights, "reportStatus", "reportAttempts", "reportStartedAt"')
      .eq("id", sessionId)
      .maybeSingle();
    if (!error) return (data as Row | null) ?? null;
    if (!isMissingColumn(error)) throw new Error(error.message);
    reportColumnsMissing = true;
    log.warn("Report status columns missing (apply db/init/28-report-status.sql); running without a lock");
  }
  const { data } = await supabaseAdmin
    .from("sessions")
    .select("id, status, summary, insights")
    .eq("id", sessionId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Best-effort status write; never throws (column may not exist yet). */
export async function setReportStatus(
  sessionId: string,
  status: ReportStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (reportColumnsMissing) return;
  try {
    const { error } = await supabaseAdmin
      .from("sessions")
      .update({ reportStatus: status, ...extra })
      .eq("id", sessionId);
    if (isMissingColumn(error)) reportColumnsMissing = true;
  } catch {
    /* ignore */
  }
}

/** Claim the GENERATING lock. Returns false when another worker holds it. */
async function claim(row: Row, nowMs: number): Promise<boolean> {
  if (reportColumnsMissing) return !inFlight.has(row.id);
  const staleIso = new Date(nowMs - REPORT_LOCK_STALE_MS).toISOString();
  const attempts = row.reportAttempts ?? 0;
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .update({
      reportStatus: "GENERATING",
      reportStartedAt: new Date(nowMs).toISOString(),
      reportAttempts: attempts + 1,
      reportError: null,
    })
    .eq("id", row.id)
    .eq("reportAttempts", attempts)
    .or(`reportStatus.is.null,reportStatus.neq.GENERATING,reportStartedAt.is.null,reportStartedAt.lt.${staleIso}`)
    .select("id");
  if (error) {
    if (isMissingColumn(error)) {
      reportColumnsMissing = true;
      return !inFlight.has(row.id);
    }
    throw new Error(error.message);
  }
  return Array.isArray(data) && data.length > 0;
}

const inFlight = new Set<string>();
/** Attempt counts when the status columns are missing (pre-migration). */
const memAttempts = new Map<string, number>();
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

export type EnsureResult =
  | "generated"
  | "capture_failure"
  | "no_messages"
  | "skipped"
  | "busy"
  | "failed";

/**
 * Generate the report for an ended session if it has none yet.
 * `force` regenerates even when a report exists (late completion after abandon).
 */
export async function ensureSessionReport(
  sessionId: string,
  opts: { reason: string; force?: boolean } = { reason: "manual" },
): Promise<EnsureResult> {
  if (inFlight.has(sessionId)) return "busy";
  const row = await loadState(sessionId);
  if (!row) return "skipped";
  const nowMs = Date.now();

  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("role, content, contentType")
    .eq("sessionId", sessionId);
  const stats = contentStats((msgs ?? []) as { role: string; content: string; contentType: string }[]);

  const decision = decideReport(row, stats, nowMs, { force: opts.force });
  if (decision.action === "skip") {
    if (decision.reason === "has_report" && row.reportStatus !== "READY") {
      await setReportStatus(sessionId, "READY");
    } else if (decision.reason === "no_content" && row.reportStatus !== "SKIPPED") {
      await setReportStatus(sessionId, "SKIPPED", { reportError: "No candidate answers to analyse" });
    }
    if (decision.reason !== "not_ended") {
      log.info(`Report for ${sessionId} not started (${opts.reason}): ${decision.reason}`);
    }
    return decision.reason === "busy" ? "busy" : "skipped";
  }

  if (reportColumnsMissing && !opts.force && (memAttempts.get(sessionId) ?? 0) >= MAX_REPORT_ATTEMPTS) {
    return "skipped";
  }
  if (!(await claim(row, nowMs))) return "busy";
  inFlight.add(sessionId);
  const attempt = reportColumnsMissing
    ? (memAttempts.get(sessionId) ?? 0) + 1
    : (row.reportAttempts ?? 0) + 1;
  if (reportColumnsMissing) memAttempts.set(sessionId, attempt);
  try {
    log.info(`Generating report for ${sessionId} (${opts.reason}, attempt ${attempt})`);
    const outcome = await generateSummaryForSession(sessionId);
    if (outcome === "no_messages") {
      await setReportStatus(sessionId, "SKIPPED", { reportError: "No transcript" });
      return "no_messages";
    }
    await setReportStatus(sessionId, "READY", { reportError: null });
    return outcome === "capture_failure" ? "capture_failure" : "generated";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Report for ${sessionId} failed (attempt ${attempt}):`, message);
    await setReportStatus(sessionId, "FAILED", { reportError: message.slice(0, 500) });
    void recordSessionError({
      sessionId,
      category: "report",
      severity: attempt >= MAX_REPORT_ATTEMPTS ? "error" : "warning",
      source: "session-report",
      message: `Automatic report failed (attempt ${attempt}/${MAX_REPORT_ATTEMPTS}): ${message.slice(0, 300)}`,
      context: { stage: "auto_report", reason: opts.reason },
    });
    if (attempt < MAX_REPORT_ATTEMPTS) {
      scheduleSessionReport(sessionId, `retry ${attempt + 1}`, retryDelayMs(attempt));
    }
    return "failed";
  } finally {
    inFlight.delete(sessionId);
  }
}

/**
 * Fire-and-forget report after `delayMs`. Marks the session PENDING right away
 * so the results page shows "Generating report…". Re-scheduling replaces the
 * earlier timer (one run per session).
 */
export function scheduleSessionReport(
  sessionId: string,
  reason: string,
  delayMs = 0,
  opts: { force?: boolean } = {},
): void {
  const prev = scheduled.get(sessionId);
  if (prev) clearTimeout(prev);
  void markPending(sessionId);
  const timer = setTimeout(() => {
    scheduled.delete(sessionId);
    void ensureSessionReport(sessionId, { reason, force: opts.force }).catch((err) =>
      log.error(`Report job for ${sessionId} crashed:`, err),
    );
  }, delayMs);
  scheduled.set(sessionId, timer);
}

async function markPending(sessionId: string): Promise<void> {
  if (reportColumnsMissing) return;
  try {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select('summary, insights, "reportStatus"')
      .eq("id", sessionId)
      .maybeSingle();
    if (!data) return;
    const row = data as { summary?: string | null; insights?: unknown; reportStatus?: string | null };
    if (row.reportStatus === "GENERATING" || hasReport(row)) return;
    await setReportStatus(sessionId, "PENDING");
  } catch {
    /* ignore */
  }
}

/**
 * Background pick-up: ended sessions in the look-back window that still have
 * no report and are not locked / given up. Also expires stale live sessions so
 * a closed tab still gets its report without anyone opening the dashboard.
 */
export async function sweepPendingReports(limit = 10): Promise<number> {
  const nowMs = Date.now();
  const since = new Date(nowMs - REPORT_SWEEP_LOOKBACK_MS).toISOString();

  // 1) Stale live sessions → ABANDONED (abandonSession schedules their report).
  try {
    const { expireIfStale } = await import("@/lib/session-link-server");
    const { data: live } = await supabaseAdmin
      .from("sessions")
      .select("id, status, interviewBeganAt, lastHeartbeatAt, lastActivityAt, startedAt, createdAt")
      .eq("status", "IN_PROGRESS")
      .not("interviewBeganAt", "is", null)
      .gte("startedAt", since)
      .limit(50);
    for (const s of live ?? []) await expireIfStale(s as Parameters<typeof expireIfStale>[0]);
  } catch (err) {
    log.error("Stale-session sweep failed:", err);
  }

  // 1b) Quiet IN_PROGRESS sessions the heartbeat check can't see (no
  // interviewBeganAt / older code / tab left open with no beats): close them
  // from their saved activity so the panel and report don't wait for a manual
  // UPDATE. Reached the interviewer's goodbye → COMPLETED, else ABANDONED.
  try {
    await closeIdleSessions(nowMs, since);
  } catch (err) {
    log.error("Idle-session sweep failed:", err);
  }

  // 2) Ended sessions with no report.
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, status, summary, insights" + (reportColumnsMissing ? "" : ', "reportStatus", "reportAttempts", "reportStartedAt"'))
    .in("status", ["COMPLETED", "ABANDONED"])
    .is("summary", null)
    .gte("startedAt", since)
    .order("startedAt", { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingColumn(error)) reportColumnsMissing = true;
    else log.error("Report sweep query failed:", error.message);
    return 0;
  }
  let started = 0;
  for (const row of (data ?? []) as unknown as Row[]) {
    if (started >= limit) break;
    if (scheduled.has(row.id) || inFlight.has(row.id)) continue;
    if (hasReport(row)) continue;
    if (row.reportStatus === "SKIPPED") continue;
    // Without the status columns we can't tell "gave up"/"no content" apart,
    // so only pick up COMPLETED sessions in that mode.
    if (reportColumnsMissing && row.status !== "COMPLETED") continue;
    const d = decideReport(row, null, nowMs);
    if (d.action !== "generate") continue;
    // FAILED rows wait for their own retry timer unless the process restarted.
    if (row.reportStatus === "FAILED" && row.reportStartedAt && nowMs - new Date(row.reportStartedAt).getTime() < 5 * 60_000) continue;
    started++;
    await ensureSessionReport(row.id, { reason: "sweep" }).catch((err) =>
      log.error(`Sweep report for ${row.id} failed:`, err),
    );
  }
  return started;
}

/** No saved activity / heartbeat for this long → the session is over. */
export const IDLE_SESSION_MS = 30 * 60 * 1000;

async function closeIdleSessions(nowMs: number, sinceIso: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from("sessions")
    .select("id, status, startedAt, interviewBeganAt, lastActivityAt, lastHeartbeatAt, activitySegments")
    .eq("status", "IN_PROGRESS")
    .gte("startedAt", sinceIso)
    .limit(50);
  for (const s of (rows ?? []) as {
    id: string;
    startedAt?: string | null;
    interviewBeganAt?: string | null;
    lastActivityAt?: string | null;
    lastHeartbeatAt?: string | null;
    activitySegments?: { enteredAt: string; leftAt: string | null }[] | null;
  }[]) {
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("role, content, contentType, timestamp")
      .eq("sessionId", s.id)
      .order("timestamp", { ascending: true });
    const messages = (msgs ?? []) as { role: string; content: string; contentType?: string; timestamp?: string }[];
    const lastAt = lastMessageAt(messages);
    const candidates = [lastAt, s.lastActivityAt, s.lastHeartbeatAt, s.interviewBeganAt]
      .map((t) => (t ? new Date(t).getTime() : NaN))
      .filter((v) => !Number.isNaN(v));
    if (candidates.length === 0) continue; // never started: leave to the preflight expiry
    const lastSeen = Math.max(...candidates);
    if (nowMs - lastSeen < IDLE_SESSION_MS) continue;
    if (messages.length === 0) continue; // nothing attempted: the link-expiry logic handles it

    const endIso = new Date(lastSeen).toISOString();
    const finished = reachedClosing(messages);
    const duration = effectiveDurationSeconds({ ...s, completedAt: null }, lastAt);
    const segments = (s.activitySegments ?? []).map((g) => (g.leftAt === null ? { ...g, leftAt: endIso } : g));
    const base = finished
      ? { status: "COMPLETED", completedAt: endIso, ...(duration ? { totalDurationSeconds: duration } : {}) }
      : { status: "ABANDONED", ...(duration ? { totalDurationSeconds: duration } : {}) };
    const write = (withExtras: boolean) =>
      supabaseAdmin
        .from("sessions")
        .update({
          ...base,
          activitySegments: segments,
          ...(withExtras ? { endReason: finished ? "COMPLETED" : "DISCONNECTED" } : {}),
        })
        .eq("id", s.id)
        .eq("status", "IN_PROGRESS")
        .select("id");
    let res = await write(true);
    if (res.error && /endReason|42703|PGRST204/.test(`${res.error.code} ${res.error.message}`)) res = await write(false);
    if (res.error || !res.data?.length) continue;
    log.info(`Idle session ${s.id} closed as ${base.status} (last activity ${endIso})`);
    scheduleSessionReport(s.id, `idle:${base.status.toLowerCase()}`, 0);
  }
}
