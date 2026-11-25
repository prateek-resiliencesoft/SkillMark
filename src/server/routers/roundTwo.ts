import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { admitParticipant, closeRoom, ensureRoom, liveKitConfig, mintRoomToken, removeParticipant } from "@/lib/livekit";
import {
  QUESTION_CATEGORIES,
  RECOMMENDATIONS,
  candidateIdentity,
  compareStyle,
  computeStyleMetrics,
  normalizePlan,
  userIdentity,
  type CopilotResult,
  type Round1Context,
} from "@/lib/round-two/types";
import { getSessionOverallScore, type SessionScoreInsights } from "@/lib/session-score";
import { appBaseUrl } from "../batch-access";
import {
  assertCanManage,
  hashRoundToken,
  isOpenRound,
  loadRoundAccess,
  newRoundToken,
  requireProjectManager,
  type RoundRow,
} from "../round-two/access";
import { buildRound1Context } from "../round-two/context";
import type { ReasoningStep } from "@/lib/ai/graph/types";
import { runCopilot } from "../round-two/copilot";
import { scheduleLine, sendRoundTwoEmail, type MailOutcome } from "../round-two/email";
import { generateQuestionPlan } from "../round-two/plan";
import { runRoundTwoReport } from "../round-two/report";
import { hasProjectAccess, protectedProcedure, publicProcedure, router } from "../trpc";

const log = createLogger("router/roundTwo");

const planItemSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
  category: z.enum(QUESTION_CATEGORIES),
  rationale: z.string().max(500).optional(),
  followUps: z.array(z.string().max(500)).max(5).optional(),
  minutes: z.number().int().min(1).max(60).optional(),
});

const candidateLink = (token: string) => `${appBaseUrl()}/r2/c/${token}`;
const interviewerLink = (token: string) => `${appBaseUrl()}/r2/join/${token}`;

/** Never send token hashes or raw context to the browser beyond what the panel needs. */
function publicRound(r: RoundRow) {
  const { candidateTokenHash: _c, ...rest } = r as RoundRow & { candidateTokenHash?: string };
  void _c;
  return { ...rest, questionPlan: normalizePlan(r.questionPlan), round1Context: (r.round1Context ?? {}) as Round1Context };
}

async function profileName(db: import("../context").Context["supabase"], userId: string, fallback: string): Promise<string> {
  const { data } = await db.from("profiles").select("name").eq("id", userId).maybeSingle();
  return (data?.name as string | null)?.trim() || fallback;
}

async function inviteParticipants(
  db: import("../context").Context["supabase"],
  round: RoundRow,
  invitedBy: string,
  people: { email: string; role: "interviewer" | "observer" }[],
): Promise<{ email: string; link: string; delivery: MailOutcome }[]> {
  const out: { email: string; link: string; delivery: MailOutcome }[] = [];
  const { data: candidate } = await db.from("candidates").select("name").eq("id", round.candidateId).maybeSingle();
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const token = newRoundToken();
    const { data: existing } = await db
      .from("round_two_participants")
      .select("id, role")
      .eq("roundTwoId", round.id)
      .ilike("email", email)
      .maybeSingle();
    if (existing?.role === "host") continue;
    const row = { email, role: p.role, inviteTokenHash: hashRoundToken(token), status: "invited", userId: null };
    const { error } = existing
      ? await db.from("round_two_participants").update(row).eq("id", existing.id)
      : await db.from("round_two_participants").insert({ ...row, roundTwoId: round.id });
    if (error) {
      log.error("invite insert failed", round.id, error.message);
      continue;
    }
    const link = interviewerLink(token);
    const delivery = await sendRoundTwoEmail(db, round.organizationId, {
      to: email,
      subject: `Interview panel invite: ${candidate?.name ?? round.title}`,
      lines: [
        `${invitedBy} invited you to join a round 2 interview panel for ${candidate?.name ?? "a candidate"} (${round.title}).`,
        scheduleLine(round.scheduledAt, round.durationMin),
        "Sign in with Google or your ResilienceSoft Interview account using this email address to join.",
      ],
      ctaUrl: link,
      ctaLabel: "Join the panel",
    });
    out.push({ email, link, delivery });
  }
  return out;
}

export const roundTwoRouter = router({
  /** Approved candidates in a project, with their latest round 2 (if any). */
  watchlist: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    if (!(await hasProjectAccess(ctx.supabase, input.projectId, ctx.user.id))) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const { data: interviews } = await ctx.supabase.from("interviews").select("id, title").eq("projectId", input.projectId);
    const ids = (interviews ?? []).map((i) => i.id as string);
    if (ids.length === 0) return { candidates: [] };
    const titles = new Map((interviews ?? []).map((i) => [i.id as string, i.title as string]));

    const { data: rows } = await ctx.supabase
      .from("candidates")
      .select(
        'id, name, email, phone, "interviewId", "sessionId", "decisionStatus", "watchlistedAt", "updatedAt", session:sessions!candidates_sessionId_fkey(id, insights, "completedAt")',
      )
      .in("interviewId", ids)
      .eq("decisionStatus", "approved")
      .is("watchlistDismissedAt", null)
      .order("updatedAt", { ascending: false })
      .limit(300);

    const candidateIds = (rows ?? []).map((r) => r.id as string);
    const { data: rounds } = candidateIds.length
      ? await ctx.supabase
          .from("round_two_interviews")
          .select('id, "candidateId", status, "scheduledAt", "reportStatus", report, "createdAt"')
          .in("candidateId", candidateIds)
          .order("createdAt", { ascending: false })
      : { data: [] };
    const latest = new Map<string, NonNullable<typeof rounds>[number]>();
    for (const r of rounds ?? []) if (!latest.has(r.candidateId as string)) latest.set(r.candidateId as string, r);

    return {
      candidates: (rows ?? []).map((r) => {
        const session = r.session as unknown as { id: string; insights: unknown; completedAt: string | null } | null;
        const rt = latest.get(r.id as string);
        return {
          id: r.id as string,
          name: r.name as string,
          email: (r.email as string | null) ?? null,
          interviewId: r.interviewId as string,
          interviewTitle: titles.get(r.interviewId as string) ?? "",
          sessionId: session?.id ?? (r.sessionId as string | null) ?? null,
          round1Score: getSessionOverallScore(session?.insights as SessionScoreInsights),
          round1CompletedAt: session?.completedAt ?? null,
          approvedAt: (r.watchlistedAt as string | null) ?? (r.updatedAt as string),
          roundTwo: rt
            ? {
                id: rt.id as string,
                status: rt.status as string,
                scheduledAt: rt.scheduledAt as string | null,
                reportStatus: rt.reportStatus as string,
                recommendation: ((rt.report as { recommendation?: string } | null)?.recommendation ?? null) as string | null,
              }
            : null,
        };
      }),
    };
  }),

  dismissFromWatchlist: protectedProcedure
    .input(z.object({ candidateId: z.string(), dismissed: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const { data: c } = await ctx.supabase
        .from("candidates")
        .select("id, interview:interviews!inner(projectId, project:projects!inner(organizationId))")
        .eq("id", input.candidateId)
        .maybeSingle();
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      const iv = c.interview as unknown as { projectId: string; project: { organizationId: string } };
      await requireProjectManager(ctx.supabase, iv.project.organizationId, iv.projectId, ctx.user.id);
      await ctx.supabase
        .from("candidates")
        .update({ watchlistDismissedAt: input.dismissed ? new Date().toISOString() : null })
        .eq("id", input.candidateId);
      return { ok: true };
    }),

  /** Latest round 2 for a candidate (draft or live), for the session-list side panel. */
  forCandidate: protectedProcedure.input(z.object({ candidateId: z.string() })).query(async ({ ctx, input }) => {
    const { data: c } = await ctx.supabase
      .from("candidates")
      .select("id, interview:interviews!inner(projectId)")
      .eq("id", input.candidateId)
      .maybeSingle();
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
    const projectId = (c.interview as unknown as { projectId: string }).projectId;
    if (!(await hasProjectAccess(ctx.supabase, projectId, ctx.user.id))) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const { data: rt } = await ctx.supabase
      .from("round_two_interviews")
      .select('id, status, "scheduledAt", "reportStatus", title')
      .eq("candidateId", input.candidateId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rt) return null;
    return {
      id: rt.id as string,
      status: rt.status as string,
      scheduledAt: rt.scheduledAt as string | null,
      reportStatus: rt.reportStatus as string,
      title: rt.title as string,
    };
  }),

  /** Round 2 interviews in a project (newest first). */
  list: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    if (!(await hasProjectAccess(ctx.supabase, input.projectId, ctx.user.id))) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const { data } = await ctx.supabase
      .from("round_two_interviews")
      .select('id, title, status, "scheduledAt", "durationMin", "reportStatus", report, "createdAt", candidate:candidates!inner(id, name)')
      .eq("projectId", input.projectId)
      .neq("status", "draft")
      .order("createdAt", { ascending: false })
      .limit(200);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as string,
      scheduledAt: r.scheduledAt as string | null,
      durationMin: r.durationMin as number,
      reportStatus: r.reportStatus as string,
      recommendation: ((r.report as { recommendation?: string } | null)?.recommendation ?? null) as string | null,
      candidate: r.candidate as unknown as { id: string; name: string },
    }));
  }),

  /** Rounds the caller was invited to (any org) — for external panelists' landing. */
  myInvites: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from("round_two_participants")
      .select('role, status, round:round_two_interviews!inner(id, title, status, "scheduledAt")')
      .eq("userId", ctx.user.id)
      .neq("status", "revoked");
    return (data ?? []).map((p) => ({ role: p.role as string, ...(p.round as unknown as { id: string; title: string; status: string; scheduledAt: string | null }) }));
  }),

  /** Start (or resume) a draft for a candidate: snapshots round 1 context for the AI. */
  createDraft: protectedProcedure
    .input(
      z
        .object({ candidateId: z.string().optional(), sessionId: z.string().optional() })
        .refine((v) => v.candidateId || v.sessionId, "candidateId or sessionId is required"),
    )
    .mutation(async ({ ctx, input }) => {
      let candidateId = input.candidateId;
      if (!candidateId && input.sessionId) {
        const { data: s } = await ctx.supabase.from("sessions").select('"candidateId"').eq("id", input.sessionId).maybeSingle();
        candidateId = (s?.candidateId as string | null) ?? undefined;
        if (!candidateId) {
          const { data: byLink } = await ctx.supabase.from("candidates").select("id").eq("sessionId", input.sessionId).maybeSingle();
          candidateId = (byLink?.id as string | undefined) ?? undefined;
        }
      }
      if (!candidateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Round 2 needs a candidate record. Add this person as a candidate first." });
      }
      const { data: c } = await ctx.supabase
        .from("candidates")
        .select('id, name, "sessionId", interview:interviews!inner(id, title, projectId, project:projects!inner(organizationId))')
        .eq("id", candidateId)
        .maybeSingle();
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
      const iv = c.interview as unknown as { id: string; title: string; projectId: string; project: { organizationId: string } };
      await requireProjectManager(ctx.supabase, iv.project.organizationId, iv.projectId, ctx.user.id);

      const { data: existing } = await ctx.supabase
        .from("round_two_interviews")
        .select("id")
        .eq("candidateId", candidateId)
        .eq("status", "draft")
        .eq("hostUserId", ctx.user.id)
        .maybeSingle();
      if (existing) return { id: existing.id as string };

      const sessionId = input.sessionId ?? (c.sessionId as string | null) ?? null;
      const round1Context = await buildRound1Context(ctx.supabase, iv.project.organizationId, candidateId, sessionId);
      const id = crypto.randomUUID();
      const { error } = await ctx.supabase.from("round_two_interviews").insert({
        id,
        organizationId: iv.project.organizationId,
        projectId: iv.projectId,
        candidateId,
        sourceSessionId: sessionId,
        hostUserId: ctx.user.id,
        title: `Round 2 · ${iv.title}`,
        status: "draft",
        livekitRoom: `r2-${id}`,
        candidateTokenHash: hashRoundToken(newRoundToken()),
        round1Context,
      });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      const hostEmail = ctx.user.email.toLowerCase();
      await ctx.supabase.from("round_two_participants").insert({
        roundTwoId: id,
        userId: ctx.user.id,
        email: hostEmail,
        name: await profileName(ctx.supabase, ctx.user.id, hostEmail),
        role: "host",
        status: "accepted",
      });
      return { id };
    }),

  /** Panel view of one round (no secrets). */
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    const r = access.round;
    const [{ data: candidate }, { data: participants }, { data: cards }] = await Promise.all([
      ctx.supabase.from("candidates").select('id, name, email, phone, "interviewId", "sessionId"').eq("id", r.candidateId).maybeSingle(),
      ctx.supabase
        .from("round_two_participants")
        .select('id, "userId", email, name, role, status, "joinedAt"')
        .eq("roundTwoId", r.id)
        .neq("status", "revoked")
        .order("createdAt", { ascending: true }),
      ctx.supabase.from("round_two_scorecards").select("*").eq("roundTwoId", r.id),
    ]);
    const mine = (cards ?? []).find((c) => c.userId === ctx.user.id) ?? null;
    const canSeeOthers = access.canManage && r.status === "ended" ? true : !!mine?.submittedAt;
    return {
      round: publicRound(r),
      candidate,
      participants: participants ?? [],
      myRole: access.role,
      canManage: access.canManage,
      liveKitConfigured: !!liveKitConfig(),
      myScorecard: mine,
      scorecards: canSeeOthers ? (cards ?? []).filter((c) => c.submittedAt) : [],
    };
  }),

  /** Live panel feed: transcript, latest copilot output, notes, style signals. */
  live: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    const r = access.round;
    const [{ data: segs }, { data: events }, { data: notes }] = await Promise.all([
      ctx.supabase
        .from("round_two_transcript")
        .select('id, "speakerRole", "speakerName", text, "startMs", "endMs"')
        .eq("roundTwoId", r.id)
        .order("startMs", { ascending: false })
        .limit(400),
      ctx.supabase
        .from("round_two_ai_events")
        .select("id, kind, trigger, payload, \"createdAt\"")
        .eq("roundTwoId", r.id)
        .order("createdAt", { ascending: false })
        .limit(15),
      ctx.supabase
        .from("round_two_notes")
        .select('id, "authorUserId", "authorName", body, visibility, kind, "offsetMs", "createdAt"')
        .eq("roundTwoId", r.id)
        .or(`visibility.eq.shared,authorUserId.eq.${ctx.user.id}`)
        .order("createdAt", { ascending: true })
        .limit(500),
    ]);
    const transcript = (segs ?? []).reverse();
    const r1 = (r.round1Context ?? {}) as Round1Context;
    const styleR1 = computeStyleMetrics(r1.candidateAnswers ?? []);
    const styleR2 = computeStyleMetrics(
      transcript
        .filter((s) => s.speakerRole === "candidate")
        .map((s) => ({ speakerRole: "candidate" as const, text: s.text as string, startMs: s.startMs as number, endMs: s.endMs as number })),
    );
    const copilot = (events ?? []).map((e) => ({
      id: e.id as string,
      trigger: e.trigger as string,
      createdAt: e.createdAt as string,
      ...(e.payload as CopilotResult & { ask?: { text: string; by: string } | null; steps?: ReasoningStep[] }),
    }));
    return {
      status: r.status,
      startedAt: r.startedAt,
      candidateAdmittedAt: r.candidateAdmittedAt,
      liveSummary: r.liveSummary,
      coveredQuestionIds: r.coveredQuestionIds ?? [],
      transcript,
      copilot,
      flags: copilot.flatMap((c) => c.flags ?? []),
      notes: notes ?? [],
      style: { round1: styleR1, round2: styleR2, notes: compareStyle(styleR1, styleR2) },
    };
  }),

  /** AI chat that builds / edits the question plan. */
  planChat: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        instruction: z.string().trim().max(4000),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40),
        durationMin: z.number().int().min(10).max(240).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      assertCanManage(access);
      const r = access.round;
      try {
        const context = (r.round1Context ?? {}) as Round1Context;
        const out = await generateQuestionPlan({
          roundTwoId: r.id,
          organizationId: r.organizationId,
          userId: ctx.user.id,
          context,
          durationMin: input.durationMin ?? r.durationMin,
          currentPlan: normalizePlan(r.questionPlan),
          history: input.history,
          instruction: input.instruction,
        });
        const cacheClaims = !context.cvClaims?.length && out.cvClaims.length > 0;
        await ctx.supabase
          .from("round_two_interviews")
          .update({
            questionPlan: out.plan,
            ...(cacheClaims ? { round1Context: { ...context, cvClaims: out.cvClaims } } : {}),
            updatedAt: new Date().toISOString(),
          })
          .eq("id", r.id);
        return { reply: out.reply, plan: out.plan, gaps: out.gaps, steps: out.steps, runId: out.runId };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "AI request failed" });
      }
    }),

  updatePlan: protectedProcedure
    .input(z.object({ id: z.string(), plan: z.array(planItemSchema).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      assertCanManage(access);
      await ctx.supabase
        .from("round_two_interviews")
        .update({ questionPlan: input.plan, updatedAt: new Date().toISOString() })
        .eq("id", input.id);
      return { ok: true };
    }),

  /** Draft → scheduled: sets details, invites panel, returns the candidate link once. */
  schedule: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).max(200),
        scheduledAt: z.string().datetime().nullable(),
        durationMin: z.number().int().min(10).max(240),
        interviewers: z.array(z.object({ email: z.string().email(), role: z.enum(["interviewer", "observer"]) })).max(15),
        emailCandidate: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      assertCanManage(access);
      const r = access.round;
      if (!isOpenRound(r.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "This interview is already closed" });
      const token = newRoundToken();
      const { data: updated, error } = await ctx.supabase
        .from("round_two_interviews")
        .update({
          title: input.title,
          scheduledAt: input.scheduledAt,
          durationMin: input.durationMin,
          status: r.status === "draft" ? "scheduled" : r.status,
          candidateTokenHash: hashRoundToken(token),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", r.id)
        .select("*")
        .single();
      if (error || !updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error?.message });
      const round = updated as RoundRow;
      const hostName = await profileName(ctx.supabase, ctx.user.id, ctx.user.email);
      const invites = await inviteParticipants(
        ctx.supabase,
        round,
        hostName,
        input.interviewers.filter((p) => p.email.toLowerCase() !== ctx.user.email.toLowerCase()),
      );

      const link = candidateLink(token);
      let candidateDelivery: MailOutcome = { status: "skipped" };
      const { data: cand } = await ctx.supabase.from("candidates").select("name, email").eq("id", round.candidateId).maybeSingle();
      if (input.emailCandidate && cand?.email) {
        candidateDelivery = await sendRoundTwoEmail(ctx.supabase, round.organizationId, {
          to: cand.email as string,
          toName: cand.name as string,
          subject: `Your next interview: ${round.title}`,
          lines: [
            `Hi ${cand.name},`,
            "Congratulations on clearing the first round. You're invited to a live video interview with our team.",
            scheduleLine(round.scheduledAt, round.durationMin),
            "Use a laptop with a camera and microphone, in a quiet place. Open the link a few minutes early to check your devices.",
          ],
          ctaUrl: link,
          ctaLabel: "Join the interview",
        });
      }
      return { candidateLink: link, candidateDelivery, invites };
    }),

  invite: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        people: z.array(z.object({ email: z.string().email(), role: z.enum(["interviewer", "observer"]) })).min(1).max(15),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      assertCanManage(access);
      if (!isOpenRound(access.round.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "This interview is closed" });
      const hostName = await profileName(ctx.supabase, ctx.user.id, ctx.user.email);
      return { invites: await inviteParticipants(ctx.supabase, access.round, hostName, input.people) };
    }),

  revokeParticipant: protectedProcedure
    .input(z.object({ id: z.string(), participantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      assertCanManage(access);
      const { data: p } = await ctx.supabase
        .from("round_two_participants")
        .select('id, "userId", role')
        .eq("id", input.participantId)
        .eq("roundTwoId", input.id)
        .maybeSingle();
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      if (p.role === "host") throw new TRPCError({ code: "BAD_REQUEST", message: "The host can't be removed" });
      await ctx.supabase.from("round_two_participants").update({ status: "revoked", inviteTokenHash: null }).eq("id", p.id);
      if (p.userId && liveKitConfig()) await removeParticipant(access.round.livekitRoom, userIdentity(p.userId as string));
      return { ok: true };
    }),

  /** New candidate link (old one stops working). */
  rotateCandidateLink: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    assertCanManage(access);
    const token = newRoundToken();
    await ctx.supabase.from("round_two_interviews").update({ candidateTokenHash: hashRoundToken(token) }).eq("id", input.id);
    return { candidateLink: candidateLink(token) };
  }),

  /** Pre-login view of an interviewer invite (title + which email it's for). */
  inviteInfo: publicProcedure.input(z.object({ token: z.string().min(10).max(200) })).query(async ({ ctx, input }) => {
    const { data: p } = await ctx.supabase
      .from("round_two_participants")
      .select('email, role, status, round:round_two_interviews!inner(id, title, status, "scheduledAt", "durationMin", "organizationId")')
      .eq("inviteTokenHash", hashRoundToken(input.token))
      .maybeSingle();
    if (!p || p.status === "revoked") return null;
    const round = p.round as unknown as { id: string; title: string; status: string; scheduledAt: string | null; durationMin: number; organizationId: string };
    const { data: org } = await ctx.supabase.from("organizations").select("name").eq("id", round.organizationId).maybeSingle();
    const [user, domain] = (p.email as string).split("@");
    return {
      title: round.title,
      status: round.status,
      scheduledAt: round.scheduledAt,
      durationMin: round.durationMin,
      organizationName: (org?.name as string | undefined) ?? "",
      role: p.role as string,
      emailHint: `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`,
      signedInEmail: ctx.user?.email ?? null,
    };
  }),

  /** Bind an interviewer invite to the signed-in account (email must match). */
  acceptInvite: protectedProcedure.input(z.object({ token: z.string().min(10).max(200) })).mutation(async ({ ctx, input }) => {
    const { data: p } = await ctx.supabase
      .from("round_two_participants")
      .select('id, "roundTwoId", email, status, "userId"')
      .eq("inviteTokenHash", hashRoundToken(input.token))
      .maybeSingle();
    if (!p || p.status === "revoked") throw new TRPCError({ code: "NOT_FOUND", message: "This invite is no longer valid" });
    if ((p.email as string).toLowerCase() !== ctx.user.email.toLowerCase()) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This invite was sent to a different email address. Sign in with that address, or ask the host to invite ${ctx.user.email}.`,
      });
    }
    if (p.userId && p.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Invite already used" });
    await ctx.supabase
      .from("round_two_participants")
      .update({
        userId: ctx.user.id,
        status: p.status === "joined" ? "joined" : "accepted",
        name: await profileName(ctx.supabase, ctx.user.id, ctx.user.email),
      })
      .eq("id", p.id);
    return { roundTwoId: p.roundTwoId as string };
  }),

  /** LiveKit token for a panelist. First panel join flips the round to live. */
  joinToken: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    const r = access.round;
    if (r.status !== "scheduled" && r.status !== "live") {
      throw new TRPCError({ code: "BAD_REQUEST", message: r.status === "draft" ? "Schedule the interview first" : "This interview has ended" });
    }
    const cfg = liveKitConfig();
    if (!cfg) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live video is not configured on this server" });
    if (access.role === "observer" && r.status !== "live") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The interview hasn't started yet" });
    }
    await ensureRoom(r.livekitRoom);
    const name = await profileName(ctx.supabase, ctx.user.id, ctx.user.email);
    const token = await mintRoomToken({
      room: r.livekitRoom,
      identity: userIdentity(ctx.user.id),
      name,
      kind: "panel",
      metadata: { role: access.role },
    });
    const now = new Date().toISOString();
    if (r.status === "scheduled") {
      await ctx.supabase.from("round_two_interviews").update({ status: "live", startedAt: now, updatedAt: now }).eq("id", r.id).eq("status", "scheduled");
    }
    if (access.participant) {
      await ctx.supabase
        .from("round_two_participants")
        .update({ status: "joined", joinedAt: access.participant.joinedAt ?? now })
        .eq("id", access.participant.id);
    }
    return { url: cfg.publicUrl, token, identity: userIdentity(ctx.user.id), role: access.role };
  }),

  admitCandidate: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    assertCanManage(access);
    if (access.round.status !== "live") throw new TRPCError({ code: "BAD_REQUEST", message: "Interview is not live" });
    try {
      await admitParticipant(access.round.livekitRoom, candidateIdentity(access.round.id));
    } catch (err) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? `Candidate is not in the lobby (${err.message})` : "Candidate is not in the lobby" });
    }
    await ctx.supabase
      .from("round_two_interviews")
      .update({ candidateAdmittedAt: access.round.candidateAdmittedAt ?? new Date().toISOString() })
      .eq("id", input.id);
    return { ok: true };
  }),

  addNote: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        body: z.string().trim().min(1).max(4000),
        visibility: z.enum(["private", "shared"]).default("shared"),
        kind: z.enum(["note", "chat"]).default("note"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      const r = access.round;
      const offsetMs = r.startedAt ? Math.max(0, Date.now() - new Date(r.startedAt).getTime()) : null;
      const { error } = await ctx.supabase.from("round_two_notes").insert({
        roundTwoId: r.id,
        authorUserId: ctx.user.id,
        authorName: await profileName(ctx.supabase, ctx.user.id, ctx.user.email),
        body: input.body,
        visibility: input.kind === "chat" ? "shared" : input.visibility,
        kind: input.kind,
        offsetMs,
      });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  /** Manual copilot run; `text` asks the AI something specific. */
  askCopilot: protectedProcedure
    .input(z.object({ id: z.string(), text: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      if (access.round.status !== "live") throw new TRPCError({ code: "BAD_REQUEST", message: "Interview is not live" });
      const by = await profileName(ctx.supabase, ctx.user.id, ctx.user.email);
      const result = await runCopilot(access.round.id, input.text ? "ask" : "manual", input.text ? { text: input.text, by } : undefined);
      if (!result) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The copilot is busy or out of budget. Try again in a moment." });
      return result;
    }),

  setCovered: protectedProcedure
    .input(z.object({ id: z.string(), questionId: z.string().max(40), covered: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      const set = new Set(access.round.coveredQuestionIds ?? []);
      if (input.covered) set.add(input.questionId);
      else set.delete(input.questionId);
      await ctx.supabase.from("round_two_interviews").update({ coveredQuestionIds: Array.from(set) }).eq("id", input.id);
      return { ok: true };
    }),

  saveScorecard: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        scores: z.record(z.string().max(80), z.number().int().min(1).max(5)),
        recommendation: z.enum(RECOMMENDATIONS).nullable(),
        comments: z.string().max(6000).default(""),
        submit: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
      if (access.role === "observer") throw new TRPCError({ code: "FORBIDDEN", message: "Observers don't submit scorecards" });
      if (input.submit && !input.recommendation) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a recommendation before submitting" });
      }
      const { data: existing } = await ctx.supabase
        .from("round_two_scorecards")
        .select('id, "submittedAt"')
        .eq("roundTwoId", input.id)
        .eq("userId", ctx.user.id)
        .maybeSingle();
      const row = {
        scores: input.scores,
        recommendation: input.recommendation,
        comments: input.comments,
        userName: await profileName(ctx.supabase, ctx.user.id, ctx.user.email),
        submittedAt: input.submit ? new Date().toISOString() : (existing?.submittedAt ?? null),
        updatedAt: new Date().toISOString(),
      };
      const { error } = existing
        ? await ctx.supabase.from("round_two_scorecards").update(row).eq("id", existing.id)
        : await ctx.supabase.from("round_two_scorecards").insert({ ...row, roundTwoId: input.id, userId: ctx.user.id });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      // A late scorecard should be reflected in an already generated report.
      if (input.submit && access.round.reportStatus === "ready") {
        await ctx.supabase.from("round_two_interviews").update({ reportStatus: "pending", reportAttempts: 0 }).eq("id", input.id);
        void runRoundTwoReport(input.id);
      }
      return { ok: true };
    }),

  /** End for everyone: closes the room and queues the async report. */
  end: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    assertCanManage(access);
    const r = access.round;
    if (r.status !== "live" && r.status !== "scheduled") throw new TRPCError({ code: "BAD_REQUEST", message: "Interview is not running" });
    const now = new Date().toISOString();
    const wasLive = r.status === "live";
    await ctx.supabase
      .from("round_two_interviews")
      .update({
        status: wasLive ? "ended" : "no_show",
        endedAt: now,
        reportStatus: wasLive ? "pending" : "none",
        reportAttempts: 0,
        updatedAt: now,
      })
      .eq("id", r.id);
    if (liveKitConfig()) await closeRoom(r.livekitRoom);
    if (wasLive) void runRoundTwoReport(r.id);
    return { ok: true };
  }),

  cancel: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    assertCanManage(access);
    if (!isOpenRound(access.round.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Interview already closed" });
    await ctx.supabase.from("round_two_interviews").update({ status: "cancelled", updatedAt: new Date().toISOString() }).eq("id", input.id);
    if (liveKitConfig()) await closeRoom(access.round.livekitRoom);
    return { ok: true };
  }),

  retryReport: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const access = await loadRoundAccess(ctx.supabase, input.id, ctx.user.id);
    assertCanManage(access);
    if (access.round.status !== "ended") throw new TRPCError({ code: "BAD_REQUEST", message: "Interview hasn't ended" });
    await ctx.supabase.from("round_two_interviews").update({ reportStatus: "pending", reportAttempts: 0 }).eq("id", input.id);
    void runRoundTwoReport(input.id);
    return { ok: true };
  }),
});
