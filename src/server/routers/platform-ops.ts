/**
 * Platform admin: charts, org sessions/candidates, session actions, member
 * activity, app error log and live server condition. Admin-only
 * (platformProcedure = profiles.role ADMIN), same as the platform router.
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dailySeries, statusBreakdown, usageByOrg } from "@/lib/admin-stats";
import { readHostHealth } from "@/lib/host-health";
import { abandonSession } from "@/lib/session-link-server";
import { scheduleSessionReport } from "@/lib/session-report-server";
import { updatePassword } from "@/lib/users";
import { issueNewInviteLink } from "../new-invite-link";
import { listFeedback } from "../candidate-feedback";
import { writePlatformAudit } from "../tenant";
import { platformProcedure, router } from "../trpc";
import type { Context } from "../context";

type Db = Context["supabase"];

const LIVE_HEARTBEAT_MS = 2 * 60_000;

/** interviewId -> organizationId, plus org names (excluding deleted orgs). */
async function interviewOrgMap(db: Db, interviewIds?: string[]) {
  let q = db.from("interviews").select("id, projectId");
  if (interviewIds) q = q.in("id", interviewIds.length ? interviewIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: interviews } = await q;
  const projectIds = Array.from(new Set((interviews ?? []).map((i) => i.projectId as string).filter(Boolean)));
  const { data: projects } = projectIds.length
    ? await db.from("projects").select("id, organizationId").in("id", projectIds)
    : { data: [] as { id: string; organizationId: string }[] };
  const projOrg: Record<string, string> = {};
  for (const p of projects ?? []) projOrg[p.id as string] = p.organizationId as string;
  const orgOf: Record<string, string | undefined> = {};
  for (const i of interviews ?? []) orgOf[i.id as string] = projOrg[i.projectId as string];
  return orgOf;
}

async function orgInterviewIds(db: Db, orgId: string) {
  const { data: projects } = await db.from("projects").select("id").eq("organizationId", orgId);
  const ids = (projects ?? []).map((p) => p.id as string);
  if (!ids.length) return [] as { id: string; title: string; userId: string; isActive: boolean; createdAt: string }[];
  const { data } = await db
    .from("interviews")
    .select("id, title, userId, isActive, createdAt")
    .in("projectId", ids)
    .order("createdAt", { ascending: false });
  return (data ?? []) as { id: string; title: string; userId: string; isActive: boolean; createdAt: string }[];
}

async function sessionOrg(db: Db, sessionId: string) {
  const { data: s } = await db.from("sessions").select("id, interviewId, status").eq("id", sessionId).maybeSingle();
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
  const orgOf = await interviewOrgMap(db, [s.interviewId as string]);
  return { session: s, organizationId: orgOf[s.interviewId as string] ?? null };
}

type SessionRow = Record<string, unknown>;

function sessionView(s: SessionRow, cand?: Record<string, unknown>) {
  const hb = s.lastHeartbeatAt as string | null | undefined;
  return {
    id: s.id as string,
    interviewId: s.interviewId as string,
    candidateId: (cand?.id as string | undefined) ?? (s.candidateId as string | null | undefined) ?? null,
    name: (cand?.name as string | undefined) ?? (s.participantName as string | null) ?? "Unnamed",
    email: (cand?.email as string | undefined) ?? (s.participantEmail as string | null) ?? null,
    status: s.status as string,
    endReason: (s.endReason as string | null | undefined) ?? null,
    reportStatus:
      (s.reportStatus as string | null | undefined) ??
      (s.summary || s.insights ? "READY" : null),
    hasReport: !!(s.summary || s.insights),
    live: s.status === "IN_PROGRESS" && !!hb && Date.now() - new Date(hb).getTime() < LIVE_HEARTBEAT_MS,
    durationSeconds: (s.totalDurationSeconds as number | null) ?? null,
    createdAt: s.createdAt as string,
    completedAt: (s.completedAt as string | null) ?? null,
  };
}

export const platformOpsRouter = router({
  /** Candidate feedback from the thank-you screen, newest first, with a summary. */
  feedbackList: platformProcedure
    .input(
      z.object({
        organizationId: z.string().uuid().optional(),
        rating: z.number().int().min(1).max(5).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        search: z.string().max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => listFeedback(ctx.supabase, input)),

  /** Real counts for the overview charts. */
  overviewStats: platformProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(30),
        timeZone: z.string().max(64).default("UTC"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - input.days * 86_400_000).toISOString();
      const [{ data: sessions, error }, { data: orgs }, { count: interviewsCreated }] = await Promise.all([
        ctx.supabase
          .from("sessions")
          .select("id, interviewId, status, createdAt")
          .gte("createdAt", since)
          .order("createdAt", { ascending: false })
          .limit(20_000),
        ctx.supabase.from("organizations").select("id, name, status").neq("status", "DELETED"),
        ctx.supabase.from("interviews").select("id", { count: "exact", head: true }).gte("createdAt", since),
      ]);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      const rows = (sessions ?? []) as { id: string; interviewId: string; status: string; createdAt: string }[];
      const orgOf = await interviewOrgMap(ctx.supabase, Array.from(new Set(rows.map((r) => r.interviewId))));
      const orgName: Record<string, string> = {};
      for (const o of orgs ?? []) orgName[o.id as string] = o.name as string;
      const completed = rows.filter((r) => r.status === "COMPLETED").length;
      return {
        days: input.days,
        totals: {
          sessions: rows.length,
          completed,
          completionRate: rows.length ? Math.round((completed / rows.length) * 100) : null,
          interviewsCreated: interviewsCreated ?? 0,
        },
        daily: dailySeries(rows, input.days, new Date(), input.timeZone),
        statuses: statusBreakdown(rows),
        byOrg: usageByOrg(rows, orgOf, orgName, 8),
        truncated: rows.length >= 20_000,
      };
    }),

  /** Interviews, sessions and invited candidates for one organization. */
  orgActivity: platformProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const interviews = await orgInterviewIds(ctx.supabase, input.orgId);
      const ids = interviews.map((i) => i.id);
      if (!ids.length) return { interviews: [], sessions: [], pendingCandidates: [] };
      const [{ data: sessions }, { data: candidates }] = await Promise.all([
        ctx.supabase.from("sessions").select("*").in("interviewId", ids).order("createdAt", { ascending: false }).limit(300),
        ctx.supabase
          .from("candidates")
          .select("id, interviewId, name, email, phone, sessionId, createdAt")
          .in("interviewId", ids)
          .order("createdAt", { ascending: false })
          .limit(1000),
      ]);
      const candBySession: Record<string, Record<string, unknown>> = {};
      for (const c of candidates ?? []) if (c.sessionId) candBySession[c.sessionId as string] = c;
      const title: Record<string, string> = {};
      for (const i of interviews) title[i.id] = i.title;
      const perInterview: Record<string, { total: number; completed: number; live: number }> = {};
      const sessionRows = (sessions ?? []).map((s) => {
        const v = sessionView(s as SessionRow, candBySession[(s as SessionRow).id as string]);
        const p = (perInterview[v.interviewId] ??= { total: 0, completed: 0, live: 0 });
        p.total += 1;
        if (v.status === "COMPLETED") p.completed += 1;
        if (v.live) p.live += 1;
        return { ...v, interviewTitle: title[v.interviewId] ?? "Interview" };
      });
      return {
        interviews: interviews.map((i) => ({
          ...i,
          sessions: perInterview[i.id]?.total ?? 0,
          completed: perInterview[i.id]?.completed ?? 0,
          live: perInterview[i.id]?.live ?? 0,
        })),
        sessions: sessionRows,
        pendingCandidates: (candidates ?? [])
          .filter((c) => !c.sessionId)
          .slice(0, 300)
          .map((c) => ({
            id: c.id as string,
            name: c.name as string,
            email: (c.email as string | null) ?? null,
            interviewTitle: title[c.interviewId as string] ?? "Interview",
            createdAt: c.createdAt as string,
          })),
      };
    }),

  /** Read-only report + transcript for one session. */
  sessionDetail: platformProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: s } = await ctx.supabase.from("sessions").select("*").eq("id", input.sessionId).maybeSingle();
      if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      const [{ data: interview }, { data: messages }, { data: cand }] = await Promise.all([
        ctx.supabase.from("interviews").select("id, title").eq("id", s.interviewId).maybeSingle(),
        ctx.supabase
          .from("messages")
          .select("id, role, content, timestamp")
          .eq("sessionId", input.sessionId)
          .order("timestamp", { ascending: true })
          .limit(500),
        ctx.supabase.from("candidates").select("id, name, email").eq("sessionId", input.sessionId).maybeSingle(),
      ]);
      return {
        ...sessionView(s as SessionRow, (cand as Record<string, unknown> | null) ?? undefined),
        interviewTitle: (interview?.title as string | undefined) ?? "Interview",
        summary: (s.summary as string | null) ?? null,
        insights: (s.insights as unknown) ?? null,
        themes: (s.themes as string[] | null) ?? [],
        reportError: (s.reportError as string | null | undefined) ?? null,
        messages: (messages ?? []).map((m) => ({
          id: m.id as string,
          role: m.role as string,
          content: m.content as string,
          timestamp: m.timestamp as string,
        })),
      };
    }),

  closeSession: platformProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { session, organizationId } = await sessionOrg(ctx.supabase, input.sessionId);
      if (session.status !== "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This session is already closed." });
      }
      const result = await abandonSession(input.sessionId, "DISCONNECTED");
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "session.close",
        targetType: "organization",
        targetId: organizationId ?? input.sessionId,
        meta: { sessionId: input.sessionId, status: result || session.status },
      });
      return { status: result || (session.status as string) };
    }),

  regenerateReport: platformProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { session, organizationId } = await sessionOrg(ctx.supabase, input.sessionId);
      if (session.status === "IN_PROGRESS") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Close the session before generating its report." });
      }
      scheduleSessionReport(input.sessionId, "admin", 0, { force: true });
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "session.regenerate_report",
        targetType: "organization",
        targetId: organizationId ?? input.sessionId,
        meta: { sessionId: input.sessionId },
      });
      return { queued: true };
    }),

  sendNewLink: platformProcedure
    .input(z.object({ candidateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: c } = await ctx.supabase
        .from("candidates")
        .select("*, session:sessions!candidates_sessionId_fkey(*)")
        .eq("id", input.candidateId)
        .maybeSingle();
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found." });
      const orgOf = await interviewOrgMap(ctx.supabase, [c.interviewId as string]);
      const organizationId = orgOf[c.interviewId as string];
      if (!organizationId) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });
      const result = await issueNewInviteLink(ctx.supabase, c, organizationId);
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "candidate.new_link",
        targetType: "organization",
        targetId: organizationId,
        meta: { candidateId: input.candidateId, name: c.name },
      });
      return result;
    }),

  /** Per-member activity in one organization (interviews they own). */
  memberActivity: platformProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const interviews = await orgInterviewIds(ctx.supabase, input.orgId);
      const out: Record<string, { interviews: number; sessions: number; completed: number; lastSessionAt: string | null }> = {};
      for (const i of interviews) {
        const a = (out[i.userId] ??= { interviews: 0, sessions: 0, completed: 0, lastSessionAt: null });
        a.interviews += 1;
      }
      if (interviews.length) {
        const owner: Record<string, string> = {};
        for (const i of interviews) owner[i.id] = i.userId;
        const { data: sessions } = await ctx.supabase
          .from("sessions")
          .select("interviewId, status, createdAt")
          .in("interviewId", interviews.map((i) => i.id))
          .limit(20_000);
        for (const s of sessions ?? []) {
          const a = out[owner[s.interviewId as string]];
          if (!a) continue;
          a.sessions += 1;
          if (s.status === "COMPLETED") a.completed += 1;
          const t = s.createdAt as string;
          if (!a.lastSessionAt || t > a.lastSessionAt) a.lastSessionAt = t;
        }
      }
      return out;
    }),

  /** Set a one-time temporary password the admin passes on to the person. */
  resetPassword: platformProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Change your own password from your account settings." });
      }
      const temp = randomBytes(9).toString("base64url");
      const { error } = await updatePassword(input.userId, temp);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error });
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: "user.reset_password",
        targetType: "user",
        targetId: input.userId,
        meta: {},
      });
      return { temporaryPassword: temp };
    }),

  /** Live condition of the server this app runs on, plus interview load. */
  hostHealth: platformProcedure.query(async ({ ctx }) => {
    const liveSince = new Date(Date.now() - LIVE_HEARTBEAT_MS).toISOString();
    const [host, { count: inProgress }, { count: live }, pending] = await Promise.all([
      readHostHealth(),
      ctx.supabase.from("sessions").select("id", { count: "exact", head: true }).eq("status", "IN_PROGRESS"),
      ctx.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "IN_PROGRESS")
        .gte("lastHeartbeatAt", liveSince),
      ctx.supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .in("reportStatus", ["PENDING", "GENERATING"]),
    ]);
    return {
      host,
      interviews: {
        inProgress: inProgress ?? 0,
        liveNow: live ?? 0,
        reportsQueued: pending.error ? null : (pending.count ?? 0),
      },
    };
  }),
});
