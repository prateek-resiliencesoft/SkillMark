/**
 * Superadmin Error Logs: loads error rows for a time range, joins them to
 * session → interview → project → organization and candidate, then hands the
 * rows to the pure report builder in src/lib/error-log-report.ts.
 */
import { buildErrorLogReport, type ErrorLogFilters, type ErrorLogReport, type ErrorLogRow, type GroupStatus, type GroupStatusRow } from "@/lib/error-log-report";
import { errorSignature, type ErrorCategory, type ErrorSeverity } from "@/lib/session-error-log";
import type { Context } from "./context";

type Db = Context["supabase"];

/** Upper bound on rows scanned per request. The UI tells the user when it is hit. */
export const MAX_ERROR_ROWS = 20_000;
const PAGE = 1000;
const IN_CHUNK = 200;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Fetch error rows in the range, oldest first, up to MAX_ERROR_ROWS. */
async function fetchErrorRows(db: Db, from: string, to: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("session_error_logs")
      .select("id, sessionId, createdAt, category, severity, source, message, status, code, signature")
      .gte("createdAt", from)
      .lt("createdAt", to)
      .order("createdAt", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (rows.length >= MAX_ERROR_ROWS) return { rows: rows.slice(0, MAX_ERROR_ROWS), truncated: true };
    if (batch.length < PAGE) return { rows, truncated: false };
  }
}

/** Look up rows by id in chunks; returns id → row. Selects "*" because the table name is dynamic. */
async function lookup(db: Db, table: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data } = await db.from(table).select("*").in("id", part);
    for (const r of (data ?? []) as Record<string, unknown>[]) map.set(r.id as string, r);
  }
  return map;
}

/** Joined error rows for the range. Missing parents stay null (deleted orgs/sessions still show their errors). */
export async function loadErrorRows(db: Db, from: string, to: string): Promise<{ rows: ErrorLogRow[]; truncated: boolean }> {
  const { rows: raw, truncated } = await fetchErrorRows(db, from, to);
  const sessionIds = Array.from(new Set(raw.map((r) => r.sessionId as string).filter(Boolean)));

  const sessions = new Map<string, Record<string, unknown>>();
  const candidatesBySession = new Map<string, { id: string; name: string | null }>();
  for (const part of chunks(sessionIds, IN_CHUNK)) {
    const { data: sess } = await db
      .from("sessions")
      .select("id, interviewId, candidateId, participantName")
      .in("id", part);
    for (const s of (sess ?? []) as Record<string, unknown>[]) sessions.set(s.id as string, s);
    const { data: cands } = await db.from("candidates").select("id, name, sessionId").in("sessionId", part);
    for (const c of (cands ?? []) as Record<string, unknown>[]) {
      candidatesBySession.set(c.sessionId as string, { id: c.id as string, name: (c.name as string) ?? null });
    }
  }

  const interviewIds = Array.from(new Set([...sessions.values()].map((s) => s.interviewId as string).filter(Boolean)));
  const interviews = await lookup(db, "interviews", interviewIds);
  const projectIds = Array.from(new Set([...interviews.values()].map((i) => i.projectId as string).filter(Boolean)));
  const projects = await lookup(db, "projects", projectIds);
  const orgIds = Array.from(new Set([...projects.values()].map((p) => p.organizationId as string).filter(Boolean)));
  const orgs = await lookup(db, "organizations", orgIds);

  const rows: ErrorLogRow[] = raw.map((r) => {
    const sessionId = r.sessionId as string;
    const session = sessions.get(sessionId);
    const interviewId = (session?.interviewId as string | undefined) ?? null;
    const interview = interviewId ? interviews.get(interviewId) : undefined;
    const project = interview?.projectId ? projects.get(interview.projectId as string) : undefined;
    const orgId = (project?.organizationId as string | undefined) ?? null;
    const candidate = candidatesBySession.get(sessionId);
    const candidateName = candidate?.name ?? (session?.participantName as string | null | undefined) ?? null;
    return {
      id: r.id as string,
      sessionId,
      createdAt: r.createdAt as string,
      category: r.category as ErrorCategory,
      severity: r.severity as ErrorSeverity,
      source: r.source as string,
      message: r.message as string,
      status: (r.status as number | null) ?? null,
      code: (r.code as string | null) ?? null,
      signature: (r.signature as string | null) ?? errorSignature({ category: r.category as string, source: r.source as string, message: r.message as string }),
      organizationId: orgId,
      organizationName: orgId ? ((orgs.get(orgId)?.name as string | undefined) ?? null) : null,
      candidateId: candidate?.id ?? (session?.candidateId as string | null | undefined) ?? null,
      candidateName: candidateName || null,
      interviewId,
      interviewTitle: (interview?.title as string | undefined) ?? null,
    };
  });
  return { rows, truncated };
}

/** Acknowledge / resolve state for the given group signatures. */
export async function loadGroupStatuses(db: Db, signatures: string[]): Promise<Map<string, GroupStatusRow>> {
  const map = new Map<string, GroupStatusRow>();
  for (const part of chunks(signatures, IN_CHUNK)) {
    const { data, error } = await db
      .from("error_log_groups")
      .select("signature, status, note, updatedAt")
      .in("signature", part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      map.set(r.signature as string, {
        status: r.status as GroupStatus,
        note: (r.note as string | null) ?? null,
        updatedAt: (r.updatedAt as string | null) ?? null,
      });
    }
  }
  return map;
}

export async function loadErrorLogReport(
  db: Db,
  input: { from: string; to: string; filters: ErrorLogFilters; page: number; pageSize: number },
): Promise<ErrorLogReport> {
  const { rows, truncated } = await loadErrorRows(db, input.from, input.to);
  const signatures = Array.from(new Set(rows.map((r) => r.signature || errorSignature(r))));
  const statuses = await loadGroupStatuses(db, signatures);
  return buildErrorLogReport(rows, {
    from: input.from,
    to: input.to,
    filters: input.filters,
    statuses,
    page: input.page,
    pageSize: input.pageSize,
    truncated,
  });
}

export async function setErrorGroupStatus(
  db: Db,
  input: { signature: string; status: GroupStatus; note: string | null; actorId: string },
): Promise<GroupStatusRow> {
  const now = new Date().toISOString();
  const { error } = await db.from("error_log_groups").upsert(
    {
      signature: input.signature,
      status: input.status,
      note: input.note,
      updatedBy: input.actorId,
      updatedAt: now,
      resolvedAt: input.status === "resolved" ? now : null,
    },
    { onConflict: "signature" },
  );
  if (error) throw new Error(error.message);
  return { status: input.status, note: input.note, updatedAt: now };
}
