/**
 * Data access for the public results API. Every query is limited to the
 * projects the API key can see (auth.projectIds, all inside the key's
 * organization). Anything outside answers 404, so other organizations' ids
 * can't be probed. `db` is injected so tests can use an in-memory fake.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildReportData } from "@/lib/report-data";
import { getSessionOverallScore } from "@/lib/session-score";
import type { z } from "zod";
import type {
  CreateInviteBody,
  ListCandidatesQuery,
  ListInterviewsQuery,
  ListSessionsQuery,
  REPORT_STATUSES,
} from "./schemas";

export type ApiDb = { from: (table: string) => any };

export type ApiAuth = {
  organizationId: string;
  projectIds: string[];
  scopes?: string[];
  apiKeyId?: string;
};

export type ApiCtx = { db: ApiDb; auth: ApiAuth; origin?: string };

export class ApiProblem extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Case-insensitive exact match for ilike (escape LIKE wildcards). */
export const likeExact = (v: string) => v.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);

const notFound = (what: string) => new ApiProblem("NOT_FOUND", `${what} not found`, 404);

/* ---------------- cursors ---------------- */

export function encodeCursor(createdAt: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown };
    if (typeof v.t === "string" && !Number.isNaN(Date.parse(v.t))) return v.t;
  } catch {
    /* fall through */
  }
  throw new ApiProblem("BAD_REQUEST", "Invalid cursor", 400, { cursor: "Use next_cursor from the previous page." });
}

function page<T extends { created_at: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  const next = rows.length > limit && data.length ? encodeCursor(data[data.length - 1].created_at) : null;
  return { data, next_cursor: next };
}

/* ---------------- mappers ---------------- */

type ReportStatus = (typeof REPORT_STATUSES)[number];

export function reportStatusOf(s: Record<string, any>): ReportStatus {
  const hasReport = !!(s.summary || (s.insights && !s.insights.captureFailure && (s.insights.keyInsights?.length || s.insights.questionEvaluations || s.insights.criteriaEvaluations)));
  const col = typeof s.reportStatus === "string" ? s.reportStatus.toUpperCase() : null;
  if (col === "READY" || hasReport) return "ready";
  if (col === "PENDING") return "pending";
  if (col === "GENERATING") return "generating";
  if (col === "FAILED") return "failed";
  return "none";
}

export function toSession(s: Record<string, any>, interviewTitle: string, cand?: Record<string, any> | null) {
  const score = getSessionOverallScore(s.insights ?? null);
  return {
    id: s.id as string,
    interview_id: s.interviewId as string,
    interview_title: interviewTitle,
    candidate_id: (cand?.id as string | undefined) ?? null,
    candidate_name: (cand?.name as string | undefined) ?? (s.participantName as string | null) ?? null,
    candidate_email: (cand?.email as string | undefined) ?? (s.participantEmail as string | null) ?? null,
    status: s.status,
    end_reason: (s.endReason as string | null | undefined) ?? null,
    report_status: reportStatusOf(s),
    overall_score: score == null ? null : Math.round(score * 10) / 10,
    duration_seconds: (s.totalDurationSeconds as number | null | undefined) ?? null,
    started_at: (s.interviewBeganAt as string | null | undefined) ?? (s.startedAt as string | null | undefined) ?? null,
    completed_at: (s.completedAt as string | null | undefined) ?? null,
    created_at: s.createdAt as string,
  };
}

export function toTranscript(messages: Record<string, any>[]) {
  return messages
    .filter((m) => (m.role === "USER" || m.role === "ASSISTANT") && m.contentType !== "WHITEBOARD" && m.contentType !== "CODE")
    .map((m) => ({
      role: m.role === "USER" ? ("candidate" as const) : ("interviewer" as const),
      content: String(m.content ?? ""),
      timestamp: String(m.timestamp ?? ""),
    }));
}

const CANDIDATE_STATUS: Record<string, "in_progress" | "completed" | "abandoned" | "disqualified"> = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
  DISQUALIFIED: "disqualified",
};

/* ---------------- scope helpers ---------------- */

async function scopedInterviews(ctx: ApiCtx, onlyId?: string) {
  if (!ctx.auth.projectIds.length) return [] as Record<string, any>[];
  let q = ctx.db.from("interviews").select("id, title, projectId").in("projectId", ctx.auth.projectIds);
  if (onlyId) q = q.eq("id", onlyId);
  const { data, error } = await q;
  if (error) throw new ApiProblem("INTERNAL_ERROR", "Could not load interviews", 500);
  return (data ?? []) as Record<string, any>[];
}

async function loadScopedSession(ctx: ApiCtx, id: string) {
  const { data: s } = await ctx.db.from("sessions").select("*").eq("id", id).maybeSingle();
  if (!s) throw notFound("Session");
  const [interview] = await scopedInterviews(ctx, s.interviewId);
  if (!interview) throw notFound("Session");
  return { session: s as Record<string, any>, interview };
}

/* ---------------- endpoints ---------------- */

export async function listSessions(ctx: ApiCtx, q: z.output<typeof ListSessionsQuery>) {
  const interviews = await scopedInterviews(ctx, q.interview_id);
  if (q.interview_id && !interviews.length) throw notFound("Interview");
  if (!interviews.length) return { data: [], next_cursor: null };
  const title = new Map(interviews.map((i) => [i.id as string, i.title as string]));
  const ids = interviews.map((i) => i.id as string);
  const before = decodeCursor(q.cursor);

  const run = (narrow: (b: any) => any) => {
    let b = ctx.db.from("sessions").select("*").in("interviewId", ids);
    if (q.status) b = b.eq("status", q.status);
    if (q.from) b = b.gte("createdAt", new Date(q.from).toISOString());
    if (q.to) b = b.lte("createdAt", new Date(q.to).toISOString());
    if (before) b = b.lt("createdAt", before);
    return narrow(b).order("createdAt", { ascending: false }).limit(q.limit + 1);
  };

  let rows: Record<string, any>[] = [];
  if (q.candidate_email) {
    const email = likeExact(q.candidate_email);
    const { data: cands } = await ctx.db.from("candidates").select("id, sessionId, email").in("interviewId", ids).ilike("email", email);
    const sids = (cands ?? []).map((c: any) => c.sessionId).filter(Boolean);
    const [a, b] = await Promise.all([
      sids.length ? run((x) => x.in("id", sids)) : Promise.resolve({ data: [] }),
      run((x) => x.ilike("participantEmail", email)),
    ]);
    const seen = new Set<string>();
    rows = [...(a.data ?? []), ...(b.data ?? [])]
      .filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((x: any, y: any) => (x.createdAt < y.createdAt ? 1 : -1));
  } else {
    const { data, error } = await run((x) => x);
    if (error) throw new ApiProblem("INTERNAL_ERROR", "Could not load sessions", 500);
    rows = data ?? [];
  }

  const sessionIds = rows.slice(0, q.limit).map((r) => r.id as string);
  const candBySession = new Map<string, Record<string, any>>();
  if (sessionIds.length) {
    const { data: cands } = await ctx.db.from("candidates").select("id, name, email, sessionId").in("sessionId", sessionIds);
    for (const c of cands ?? []) candBySession.set(c.sessionId, c);
  }
  return page(
    rows.map((r) => toSession(r, title.get(r.interviewId) ?? "Interview", candBySession.get(r.id))),
    q.limit,
  );
}

async function candidateFor(ctx: ApiCtx, sessionId: string) {
  const { data } = await ctx.db.from("candidates").select("id, name, email, sessionId").eq("sessionId", sessionId).maybeSingle();
  return (data as Record<string, any> | null) ?? null;
}

export async function getSession(ctx: ApiCtx, id: string) {
  const { session, interview } = await loadScopedSession(ctx, id);
  return { data: toSession(session, interview.title, await candidateFor(ctx, id)) };
}

async function loadMessages(ctx: ApiCtx, sessionId: string) {
  const { data } = await ctx.db
    .from("messages")
    .select("id, role, content, contentType, timestamp")
    .eq("sessionId", sessionId)
    .order("timestamp", { ascending: true })
    .limit(2000);
  return (data ?? []) as Record<string, any>[];
}

export async function getResult(ctx: ApiCtx, id: string) {
  const { session, interview } = await loadScopedSession(ctx, id);
  const messages = await loadMessages(ctx, id);
  const r = buildReportData({ ...session, interviewTitle: interview.title, messages });
  const status = reportStatusOf(session);
  const ready = status === "ready";
  return {
    data: {
      session_id: id,
      status: session.status,
      report_status: status,
      overall_score: ready && r.overallScore != null ? Math.round(r.overallScore * 10) / 10 : null,
      recommendation: ready ? r.recommendation : session.status === "DISQUALIFIED" ? "no" : null,
      summary: ready ? r.summary : null,
      strengths: ready ? r.strengths : [],
      weaknesses: ready ? r.concerns : [],
      key_insights: ready ? r.keyInsights : [],
      themes: ready ? r.themes : [],
      criteria: ready ? r.criteria : [],
      questions: ready
        ? r.questions.map((q) => ({
            question: q.question,
            score: q.score,
            evaluation: q.evaluation,
            highlights: q.highlights,
            improvements: q.improvements,
          }))
        : [],
      integrity: { disqualified: r.disqualified, strikes: r.integrityStrikes, events: r.integrity },
    },
  };
}

export async function getTranscript(ctx: ApiCtx, id: string) {
  await loadScopedSession(ctx, id);
  return { data: { session_id: id, messages: toTranscript(await loadMessages(ctx, id)) } };
}

export async function listInterviews(ctx: ApiCtx, q: z.output<typeof ListInterviewsQuery>) {
  if (!ctx.auth.projectIds.length) return { data: [], next_cursor: null };
  const before = decodeCursor(q.cursor);
  let b = ctx.db
    .from("interviews")
    .select("id, title, description, mode, isActive, timeLimitMinutes, createdAt, updatedAt, projectId")
    .in("projectId", ctx.auth.projectIds);
  if (q.active) b = b.eq("isActive", q.active === "true");
  if (before) b = b.lt("createdAt", before);
  const { data, error } = await b.order("createdAt", { ascending: false }).limit(q.limit + 1);
  if (error) throw new ApiProblem("INTERNAL_ERROR", "Could not load interviews", 500);
  const rows = (data ?? []) as Record<string, any>[];
  const ids = rows.slice(0, q.limit).map((r) => r.id as string);
  const counts = new Map<string, { s: number; c: number }>();
  if (ids.length) {
    const { data: ss } = await ctx.db.from("sessions").select("interviewId, status").in("interviewId", ids).limit(50_000);
    for (const s of ss ?? []) {
      const v = counts.get(s.interviewId) ?? { s: 0, c: 0 };
      v.s += 1;
      if (s.status === "COMPLETED") v.c += 1;
      counts.set(s.interviewId, v);
    }
  }
  return page(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      mode: r.mode ?? "CHAT",
      is_active: r.isActive !== false,
      time_limit_minutes: r.timeLimitMinutes ?? null,
      session_count: counts.get(r.id)?.s ?? 0,
      completed_count: counts.get(r.id)?.c ?? 0,
      created_at: r.createdAt,
      updated_at: r.updatedAt ?? null,
    })),
    q.limit,
  );
}

export async function listCandidates(ctx: ApiCtx, q: z.output<typeof ListCandidatesQuery>) {
  const interviews = await scopedInterviews(ctx, q.interview_id);
  if (q.interview_id && !interviews.length) throw notFound("Interview");
  if (!interviews.length) return { data: [], next_cursor: null };
  const before = decodeCursor(q.cursor);
  let b = ctx.db
    .from("candidates")
    .select("id, interviewId, name, email, phone, sessionId, expiresAt, createdAt")
    .in("interviewId", interviews.map((i) => i.id));
  if (q.email) b = b.ilike("email", likeExact(q.email));
  if (before) b = b.lt("createdAt", before);
  const { data, error } = await b.order("createdAt", { ascending: false }).limit(q.limit + 1);
  if (error) throw new ApiProblem("INTERNAL_ERROR", "Could not load candidates", 500);
  const rows = (data ?? []) as Record<string, any>[];
  const sids = rows.map((r) => r.sessionId).filter(Boolean);
  const statusBySession = new Map<string, string>();
  if (sids.length) {
    const { data: ss } = await ctx.db.from("sessions").select("id, status").in("id", sids);
    for (const s of ss ?? []) statusBySession.set(s.id, s.status);
  }
  return page(
    rows.map((r) => ({
      id: r.id,
      interview_id: r.interviewId,
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      status: (r.sessionId && CANDIDATE_STATUS[statusBySession.get(r.sessionId) ?? ""]) || ("invited" as const),
      session_id: r.sessionId ?? null,
      invite_expires_at: r.expiresAt ?? null,
      created_at: r.createdAt,
    })),
    q.limit,
  );
}

export async function createInvite(ctx: ApiCtx, body: z.output<typeof CreateInviteBody>) {
  const [interview] = await scopedInterviews(ctx, body.interview_id);
  if (!interview) throw notFound("Interview");
  if (body.send?.email && !body.email) {
    throw new ApiProblem("BAD_REQUEST", "send.email needs an email", 400, { email: "Required when send.email is true." });
  }
  if (body.send?.whatsapp && !body.phone) {
    throw new ApiProblem("BAD_REQUEST", "send.whatsapp needs a phone", 400, { phone: "Required when send.whatsapp is true." });
  }

  // Loaded lazily: these pull in mail/WhatsApp/AI clients.
  const [{ nanoid }, { resolveInviteSchedule, sendCandidateInvite }, { tailorCandidates }, { inviteLink }] = await Promise.all([
    import("@/lib/id"),
    import("@/server/invite-delivery"),
    import("@/server/candidate-tailoring"),
    import("@/server/batch-access"),
  ]);

  const { expiresAt } = resolveInviteSchedule({ inviteSchedule: "immediate" });
  const { data: candidate, error } = await ctx.db
    .from("candidates")
    .insert({
      interviewId: interview.id,
      name: body.name,
      email: body.email?.toLowerCase() ?? null,
      phone: body.phone ?? null,
      inviteToken: nanoid(12),
      expiresAt,
    })
    .select("*")
    .single();
  if (error || !candidate) throw new ApiProblem("INTERNAL_ERROR", "Could not create the invite", 500);

  await tailorCandidates(ctx.db as never, ctx.auth.organizationId, interview.id, [candidate]).catch(() => undefined);

  const delivery =
    body.send && (body.send.email || body.send.whatsapp)
      ? await sendCandidateInvite(ctx.db as never, ctx.auth.organizationId, candidate.id, {
          email: !!body.send.email,
          whatsapp: !!body.send.whatsapp,
        })
      : {};

  return {
    data: {
      candidate_id: candidate.id as string,
      interview_id: interview.id as string,
      invite_url: inviteLink(candidate.inviteToken as string),
      expires_at: (candidate.expiresAt as string | null) ?? null,
      delivery,
    },
  };
}
