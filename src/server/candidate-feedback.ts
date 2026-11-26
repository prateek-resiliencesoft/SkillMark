/**
 * Candidate feedback: submit from the thank-you screen, list for platform
 * admins, read one for the org's candidate sheet. The database is passed in
 * (supabaseAdmin in routes, a fake in tests).
 */
import { FEEDBACK_TAGS, type FeedbackInputT } from "@/lib/candidate-feedback";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder or test fake
type Db = { from: (table: string) => any };

const TABLE = "candidate_feedback";
/** Feedback is accepted for this long after the session started. */
export const FEEDBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Session states that accept feedback (ended, or being ended right now). */
const FEEDBACK_SESSION_STATUSES = new Set(["COMPLETED", "ABANDONED", "IN_PROGRESS"]);

export type FeedbackErrorCode = "UNAVAILABLE" | "NOT_FOUND" | "NOT_ENDED" | "TOO_LATE" | "FORBIDDEN" | "DUPLICATE";
export class FeedbackError extends Error {
  constructor(
    public code: FeedbackErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /candidate_feedback/.test(e.message ?? "") && /does not exist|Could not find/i.test(e.message ?? ""));
}

type SessionCtx = { sessionId: string; candidateId: string | null; organizationId: string | null; interviewId: string | null };

/** Check the session (and invite token, when given) and find its org / candidate. */
async function sessionContext(db: Db, sessionId: string, inviteToken: string | undefined, nowMs: number): Promise<SessionCtx> {
  const { data: s } = await db.from("sessions").select("id, status, interviewId, startedAt, createdAt").eq("id", sessionId).maybeSingle();
  if (!s) throw new FeedbackError("NOT_FOUND", "Session not found.", 404);
  // IN_PROGRESS too: the thank-you screen shows the form at once, while the
  // final save may still be landing (it runs in the background).
  if (!FEEDBACK_SESSION_STATUSES.has(String(s.status))) {
    throw new FeedbackError("NOT_ENDED", "Feedback opens when the interview has ended.", 409);
  }
  const started = new Date(s.startedAt ?? s.createdAt ?? 0).getTime();
  if (Number.isFinite(started) && started > 0 && nowMs - started > FEEDBACK_WINDOW_MS) {
    throw new FeedbackError("TOO_LATE", "Feedback for this interview is closed.", 410);
  }
  const { data: cand } = await db.from("candidates").select("id, inviteToken").eq("sessionId", sessionId).maybeSingle();
  if (inviteToken && (!cand || cand.inviteToken !== inviteToken)) {
    throw new FeedbackError("FORBIDDEN", "This link does not match the interview.", 403);
  }
  let organizationId: string | null = null;
  if (s.interviewId) {
    const { data: iv } = await db.from("interviews").select("id, projectId").eq("id", s.interviewId).maybeSingle();
    if (iv?.projectId) {
      const { data: p } = await db.from("projects").select("id, organizationId").eq("id", iv.projectId).maybeSingle();
      organizationId = (p?.organizationId as string | undefined) ?? null;
    }
  }
  return { sessionId, candidateId: (cand?.id as string | undefined) ?? null, organizationId, interviewId: (s.interviewId as string | null) ?? null };
}

/** Whether the form should show for this session. */
export async function feedbackStatus(
  db: Db,
  sessionId: string,
  inviteToken?: string,
  nowMs = Date.now(),
): Promise<{ available: boolean; submitted: boolean }> {
  const { data, error } = await db.from(TABLE).select("id").eq("sessionId", sessionId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { available: false, submitted: false };
    throw error;
  }
  if (data) return { available: true, submitted: true };
  try {
    await sessionContext(db, sessionId, inviteToken, nowMs);
    return { available: true, submitted: false };
  } catch (e) {
    if (e instanceof FeedbackError) return { available: false, submitted: false };
    throw e;
  }
}

/** Save one feedback per session. Throws FeedbackError on a clear refusal. */
export async function submitFeedback(
  db: Db,
  input: FeedbackInputT,
  meta: { userAgent?: string | null; nowMs?: number } = {},
): Promise<{ id: string | null }> {
  const existing = await db.from(TABLE).select("id").eq("sessionId", input.sessionId).maybeSingle();
  if (existing.error) {
    if (isMissingTable(existing.error)) throw new FeedbackError("UNAVAILABLE", "Feedback is not available right now.", 503);
    throw existing.error;
  }
  if (existing.data) throw new FeedbackError("DUPLICATE", "Feedback for this interview was already sent.", 409);

  const ctx = await sessionContext(db, input.sessionId, input.inviteToken, meta.nowMs ?? Date.now());
  const { data, error } = await db
    .from(TABLE)
    .insert({
      sessionId: ctx.sessionId,
      candidateId: ctx.candidateId,
      organizationId: ctx.organizationId,
      interviewId: ctx.interviewId,
      rating: input.rating,
      tags: input.tags,
      comment: input.comment,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 400) : null,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new FeedbackError("DUPLICATE", "Feedback for this interview was already sent.", 409);
    if (isMissingTable(error)) throw new FeedbackError("UNAVAILABLE", "Feedback is not available right now.", 503);
    throw error;
  }
  const id = (data?.id as string | undefined) ?? null;
  if (id) {
    void import("@/lib/bug-triage/enqueue")
      .then(({ enqueueFeedbackTriage }) =>
        enqueueFeedbackTriage({
          id,
          rating: input.rating,
          tags: input.tags,
          comment: input.comment,
          sessionId: ctx.sessionId,
          organizationId: ctx.organizationId,
        }),
      )
      .catch(() => {});
  }
  return { id };
}

export type FeedbackRow = {
  id: string;
  createdAt: string;
  rating: number;
  tags: string[];
  comment: string | null;
  sessionId: string;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  interviewId: string | null;
  interviewTitle: string | null;
};

export type FeedbackFilters = {
  organizationId?: string;
  rating?: number;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
};

export type FeedbackSummary = {
  total: number;
  average: number | null;
  distribution: { rating: number; count: number }[];
  topTags: { tag: string; count: number }[];
};

export function summarizeFeedback(rows: Pick<FeedbackRow, "rating" | "tags">[]): FeedbackSummary {
  const distribution = [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: rows.filter((x) => x.rating === r).length }));
  const tagCounts = new Map<string, number>();
  for (const r of rows) for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = Array.from(tagCounts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const average = rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null;
  return { total: rows.length, average, distribution, topTags };
}

/** Page size for scanning all matching feedback (PostgREST caps a single response). */
export const FEEDBACK_SCAN_PAGE = 1000;

type FeedbackRaw = Omit<FeedbackRow, "candidateName" | "candidateEmail" | "organizationName" | "interviewTitle">;

function feedbackQuery(db: Db, f: FeedbackFilters) {
  let q = db.from(TABLE).select('id, "createdAt", rating, tags, comment, "sessionId", "candidateId", "organizationId", "interviewId"');
  if (f.organizationId) q = q.eq("organizationId", f.organizationId);
  if (f.rating) q = q.eq("rating", f.rating);
  if (f.from) q = q.gte("createdAt", f.from);
  if (f.to) q = q.lte("createdAt", f.to);
  return q.order("createdAt", { ascending: false });
}

/** Load every matching feedback row (paginated) so summary totals are not capped. */
async function scanFeedbackRows(
  db: Db,
  f: FeedbackFilters,
  pageSize: number,
): Promise<{ available: boolean; raw: FeedbackRaw[] }> {
  const raw: FeedbackRaw[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await feedbackQuery(db, f).range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTable(error)) return { available: false, raw: [] };
      throw error;
    }
    const page = (data ?? []) as FeedbackRaw[];
    raw.push(...page);
    if (page.length < pageSize) break;
  }
  return { available: true, raw };
}

/** Admin list (newest first) with names, filters and a summary of the full filtered set. */
export async function listFeedback(
  db: Db,
  f: FeedbackFilters = {},
  opts: { pageSize?: number } = {},
): Promise<{ available: boolean; rows: FeedbackRow[]; summary: FeedbackSummary; orgs: { id: string; name: string }[] }> {
  const pageSize = opts.pageSize ?? FEEDBACK_SCAN_PAGE;
  const { available, raw } = await scanFeedbackRows(db, f, pageSize);
  if (!available) return { available: false, rows: [], summary: summarizeFeedback([]), orgs: [] };

  const ids = <K extends keyof FeedbackRaw>(k: K) => Array.from(new Set(raw.map((r) => r[k]).filter(Boolean))) as string[];
  const lookup = async (table: string, cols: string, list: string[]) => {
    if (!list.length) return new Map<string, Record<string, unknown>>();
    const { data: rows } = await db.from(table).select(cols).in("id", list);
    return new Map(((rows ?? []) as Record<string, unknown>[]).map((r) => [r.id as string, r]));
  };
  const [cands, orgs, ivs] = await Promise.all([
    lookup("candidates", "id, name, email", ids("candidateId")),
    lookup("organizations", "id, name", ids("organizationId")),
    lookup("interviews", "id, title", ids("interviewId")),
  ]);
  let rows: FeedbackRow[] = raw.map((r) => ({
    ...r,
    tags: r.tags ?? [],
    candidateName: (cands.get(r.candidateId ?? "")?.name as string | undefined) ?? null,
    candidateEmail: (cands.get(r.candidateId ?? "")?.email as string | undefined) ?? null,
    organizationName: (orgs.get(r.organizationId ?? "")?.name as string | undefined) ?? null,
    interviewTitle: (ivs.get(r.interviewId ?? "")?.title as string | undefined) ?? null,
  }));
  const term = f.search?.trim().toLowerCase();
  if (term) {
    rows = rows.filter((r) =>
      [r.comment, r.candidateName, r.candidateEmail, r.organizationName, r.interviewTitle, ...(r.tags ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }
  const summary = summarizeFeedback(rows);
  const orgList = Array.from(orgs.values())
    .map((o) => ({ id: o.id as string, name: (o.name as string) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { available: true, rows: rows.slice(0, f.limit ?? 200), summary, orgs: orgList };
}

/** Feedback for one session, only if it belongs to the given organization. */
export async function feedbackForSession(db: Db, sessionId: string, organizationId: string) {
  const { data, error } = await db
    .from(TABLE)
    .select('id, "createdAt", rating, tags, comment, "organizationId"')
    .eq("sessionId", sessionId)
    .eq("organizationId", organizationId)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string; createdAt: string; rating: number; tags: string[]; comment: string | null } | null) ?? null;
}

export { FEEDBACK_TAGS };
