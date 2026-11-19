/**
 * Superadmin Error Logs: groups interview errors by signature and builds the
 * page report. Pure (no database access) so it can be unit tested. The server
 * loader (src/server/error-logs.ts) does the joins and passes rows in here.
 */
import { errorSignature, type ErrorCategory, type ErrorSeverity } from "@/lib/session-error-log";

export const GROUP_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** Widest range the Error Logs page accepts. Larger ranges would scan too many rows. */
export const MAX_REPORT_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BUCKETS = 400;
const TOP_N = 5;

const SEVERITY_RANK: Record<ErrorSeverity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

/** One error row joined to its session, interview, organization and candidate. */
export interface ErrorLogRow {
  id: string;
  sessionId: string;
  createdAt: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  source: string;
  message: string;
  status: number | null;
  code: string | null;
  signature?: string | null;
  organizationId: string | null;
  organizationName: string | null;
  candidateId: string | null;
  candidateName: string | null;
  interviewId: string | null;
  interviewTitle: string | null;
}

export interface GroupStatusRow {
  status: GroupStatus;
  note: string | null;
  updatedAt: string | null;
}

export interface ErrorLogFilters {
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  organizationId?: string;
  status?: GroupStatus;
  search?: string;
}

export interface BuildErrorLogOptions {
  from: string;
  to: string;
  filters: ErrorLogFilters;
  statuses: Map<string, GroupStatusRow>;
  page: number;
  pageSize: number;
  truncated: boolean;
}

export interface ErrorGroup {
  signature: string;
  category: ErrorCategory;
  source: string;
  severity: ErrorSeverity;
  sampleMessage: string;
  count: number;
  sessionCount: number;
  firstSeen: string;
  lastSeen: string;
  status: GroupStatus;
  note: string | null;
  statusUpdatedAt: string | null;
  orgCount: number;
  candidateCount: number;
  topOrgs: { id: string | null; name: string; count: number }[];
  topCandidates: { key: string; name: string; count: number }[];
}

export interface ErrorEvent {
  id: string;
  sessionId: string;
  createdAt: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  source: string;
  message: string;
  status: number | null;
  code: string | null;
  signature: string;
  organizationId: string | null;
  organizationName: string | null;
  candidateName: string | null;
  interviewTitle: string | null;
}

export interface ErrorLogReport {
  range: { from: string; to: string; bucket: "hour" | "day" };
  truncated: boolean;
  summary: { total: number; groups: number; orgs: number; candidates: number; openGroups: number };
  organizations: { id: string; name: string }[];
  groups: ErrorGroup[];
  series: { t: string; total: number; byCategory: Partial<Record<ErrorCategory, number>> }[];
  events: { page: number; pageSize: number; total: number; items: ErrorEvent[] };
}

const time = (iso: string) => Date.parse(iso);

function candidateKey(r: ErrorLogRow) {
  return r.candidateId ?? `session:${r.sessionId}`;
}

function matchesFilters(r: ErrorLogRow, f: ErrorLogFilters, term: string | undefined) {
  if (f.category && r.category !== f.category) return false;
  if (f.severity && r.severity !== f.severity) return false;
  if (f.organizationId && r.organizationId !== f.organizationId) return false;
  if (term) {
    const hay = [r.message, r.candidateName, r.organizationName, r.interviewTitle].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(term)) return false;
  }
  return true;
}

function buildGroups(rows: (ErrorLogRow & { signature: string })[], statuses: Map<string, GroupStatusRow>): ErrorGroup[] {
  const bySig = new Map<string, (ErrorLogRow & { signature: string })[]>();
  for (const r of rows) {
    const list = bySig.get(r.signature);
    if (list) list.push(r);
    else bySig.set(r.signature, [r]);
  }

  const groups: ErrorGroup[] = [];
  for (const [signature, list] of bySig) {
    const sorted = [...list].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const orgs = new Map<string, { id: string | null; name: string; count: number }>();
    const cands = new Map<string, { key: string; name: string; count: number }>();
    const sessions = new Set<string>();
    let severity: ErrorSeverity = first.severity;
    for (const r of list) {
      sessions.add(r.sessionId);
      if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[severity]) severity = r.severity;
      const oKey = r.organizationId ?? "none";
      const o = orgs.get(oKey) ?? { id: r.organizationId, name: r.organizationName ?? "Unknown organization", count: 0 };
      o.count++;
      orgs.set(oKey, o);
      const k = candidateKey(r);
      const c = cands.get(k) ?? { key: k, name: r.candidateName ?? "Unnamed candidate", count: 0 };
      c.count++;
      cands.set(k, c);
    }
    const st = statuses.get(signature);
    const topOrgs = [...orgs.values()].sort((a, b) => b.count - a.count).slice(0, TOP_N);
    groups.push({
      signature,
      category: first.category,
      source: first.source,
      severity,
      sampleMessage: last.message,
      count: list.length,
      sessionCount: sessions.size,
      firstSeen: first.createdAt,
      lastSeen: last.createdAt,
      status: st?.status ?? "open",
      note: st?.note ?? null,
      statusUpdatedAt: st?.updatedAt ?? null,
      orgCount: [...orgs.values()].filter((o) => o.id).length,
      candidateCount: cands.size,
      topOrgs,
      topCandidates: [...cands.values()].sort((a, b) => b.count - a.count).slice(0, TOP_N),
    });
  }

  return groups.sort((a, b) => b.count - a.count || time(b.lastSeen) - time(a.lastSeen));
}

function buildSeries(rows: ErrorLogRow[], fromMs: number, toMs: number, step: number) {
  const buckets = new Map<number, { total: number; byCategory: Partial<Record<ErrorCategory, number>> }>();
  const start = Math.floor(fromMs / step) * step;
  for (let t = start, n = 0; t <= toMs && n < MAX_BUCKETS; t += step, n++) {
    buckets.set(t, { total: 0, byCategory: {} });
  }
  for (const r of rows) {
    const b = buckets.get(Math.floor(time(r.createdAt) / step) * step);
    if (!b) continue;
    b.total++;
    b.byCategory[r.category] = (b.byCategory[r.category] ?? 0) + 1;
  }
  return [...buckets.entries()].map(([t, v]) => ({ t: new Date(t).toISOString(), total: v.total, byCategory: v.byCategory }));
}

/** Build the whole Error Logs page payload from joined error rows. */
export function buildErrorLogReport(rows: ErrorLogRow[], opts: BuildErrorLogOptions): ErrorLogReport {
  const fromMs = time(opts.from);
  const toMs = time(opts.to);
  const bucket: "hour" | "day" = toMs - fromMs <= 2 * DAY_MS ? "hour" : "day";
  const step = bucket === "hour" ? HOUR_MS : DAY_MS;
  const term = opts.filters.search?.trim().toLowerCase() || undefined;

  const withSignature = rows.map((r) => ({ ...r, signature: r.signature || errorSignature(r) }));

  const orgNames = new Map<string, string>();
  for (const r of rows) if (r.organizationId) orgNames.set(r.organizationId, r.organizationName ?? "Unknown organization");
  const organizations = [...orgNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const statusOf = (sig: string): GroupStatus => opts.statuses.get(sig)?.status ?? "open";
  const filtered = withSignature.filter(
    (r) => matchesFilters(r, opts.filters, term) && (!opts.filters.status || statusOf(r.signature) === opts.filters.status),
  );

  const groups = buildGroups(filtered, opts.statuses);
  const series = buildSeries(filtered, fromMs, toMs, step);

  const orgs = new Set<string>();
  const candidates = new Set<string>();
  for (const r of filtered) {
    if (r.organizationId) orgs.add(r.organizationId);
    candidates.add(candidateKey(r));
  }

  const newestFirst = [...filtered].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const items: ErrorEvent[] = newestFirst.slice(opts.page * opts.pageSize, (opts.page + 1) * opts.pageSize).map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    category: r.category,
    severity: r.severity,
    source: r.source,
    message: r.message,
    status: r.status,
    code: r.code,
    signature: r.signature,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    candidateName: r.candidateName,
    interviewTitle: r.interviewTitle,
  }));

  return {
    range: { from: opts.from, to: opts.to, bucket },
    truncated: opts.truncated,
    summary: {
      total: filtered.length,
      groups: groups.length,
      orgs: orgs.size,
      candidates: candidates.size,
      openGroups: groups.filter((g) => g.status === "open").length,
    },
    organizations,
    groups,
    series,
    events: { page: opts.page, pageSize: opts.pageSize, total: filtered.length, items },
  };
}
