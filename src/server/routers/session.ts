import { expireIfStale, expireSessionsIfStale, isRevokedInviteToken } from "@/lib/session-link-server";
import { recordPreflightEvent } from "@/lib/preflight-server";
import { applyAntiCheatingViolation, countStrikes } from "@/lib/head-movement";
import { createLogger } from "@/lib/logger";
import { applyMediaReview, archiveSessionData, clearSessionMediaStorage } from "@/lib/media-review";
import { candidateMediaPrefix } from "@/lib/storage-paths";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { redactSessionForCandidate } from "@/lib/session-redact";
import { ERROR_CATEGORIES, ERROR_SEVERITIES, createClientErrorLimiter, summarizeErrorLog, type SessionErrorEntry } from "@/lib/session-error-log";
import { recordSessionError } from "@/lib/session-error-log-server";
import { filterAccessibleProjectIds, getOrgMembership, hasProjectAccess, protectedProcedure, publicProcedure, router } from "../trpc";

const log = createLogger("router/session");

/** Reject candidate writes once a session has been disqualified (server-enforced). */
async function assertNotDisqualified(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  sessionId: string,
) {
  const { data } = await supabase.from("sessions").select("status").eq("id", sessionId).maybeSingle();
  if (data?.status === "DISQUALIFIED") {
    throw new TRPCError({ code: "FORBIDDEN", message: "This interview has ended: the session was disqualified." });
  }
}

const allowClientErrorReport = createClientErrorLimiter();

export const sessionRouter = router({
  /** Candidate browser reports an error (voice WS drop, TTS/STT failure, JS error). */
  logClientError: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        category: z.enum(ERROR_CATEGORIES),
        severity: z.enum(ERROR_SEVERITIES).default("error"),
        message: z.string().min(1).max(1000),
        status: z.number().int().min(0).max(999).optional(),
        code: z.string().max(64).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!allowClientErrorReport(input.sessionId)) return { ok: false, limited: true };
      const { data: s } = await ctx.supabase.from("sessions").select("id").eq("id", input.sessionId).maybeSingle();
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      await recordSessionError({
        sessionId: input.sessionId,
        // Client can't claim server-only categories.
        category: input.category === "report" || input.category === "anti_cheat" ? "client" : input.category,
        severity: input.severity === "critical" ? "error" : input.severity,
        source: "client",
        message: input.message,
        status: input.status ?? null,
        code: input.code ?? null,
        context: input.context ?? {},
      });
      return { ok: true, limited: false };
    }),

  /** Error Log report for a session — org members only. */
  getErrorLog: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("id, interview:interviews!inner(projectId, project:projects!inner(organizationId))")
        .eq("id", input.sessionId)
        .maybeSingle();
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const iv = session.interview as unknown as { projectId: string; project: { organizationId: string } };
      const member = await getOrgMembership(ctx.supabase, iv.project.organizationId, ctx.user.id);
      if (!member || !(await hasProjectAccess(ctx.supabase, iv.projectId, ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { data } = await ctx.supabase
        .from("session_error_logs")
        .select("id, sessionId, createdAt, category, severity, source, message, status, code, context")
        .eq("sessionId", input.sessionId)
        .order("createdAt", { ascending: true })
        .limit(1000);
      const entries = (data ?? []) as SessionErrorEntry[];
      return { entries, summary: summarizeErrorLog(entries) };
    }),

  create: publicProcedure
    .input(
      z.object({
        interviewSlug: z.string(),
        participantName: z.string().optional(),
        participantEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("*, questions(*)")
        .eq("publicSlug", input.interviewSlug)
        .eq("isActive", true)
        .order("order", { referencedTable: "questions", ascending: true })
        .single();

      if (!interview) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Interview not found or inactive",
        });
      }

      // Enforce invite-only access via candidates table
      if (interview.requireInvite) {
        const email = input.participantEmail?.trim().toLowerCase();
        if (!email) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Email is required for invite-only interviews.",
          });
        }
        const { data: candidate } = await ctx.supabase
          .from("candidates")
          .select("id")
          .eq("interviewId", interview.id)
          .eq("email", email)
          .single();

        if (!candidate) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your email is not on the invite list for this interview.",
          });
        }
      }

      const questions = (interview.questions ?? []) as { id: string }[];

      const derivedMode = interview.voiceEnabled ? "VOICE" : "CHAT";

      const { data: sessionJson, error } = await ctx.supabase.rpc(
        "create_interview_session",
        {
          p_interview_id: interview.id,
          p_participant_name: input.participantName ?? null,
          p_participant_email: input.participantEmail ?? null,
          p_mode_used: derivedMode,
          p_current_question_id: questions[0]?.id ?? null,
        },
      );

      if (error) {
        log.error("RPC error (create):", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      const session = sessionJson as { id: string };

      return { sessionId: session.id, interview };
    }),

  createPreview: protectedProcedure
    .input(z.object({ interviewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: interviewAccess } = await ctx.supabase
        .from("interviews")
        .select("id, projectId, project:projects!inner(organizationId)")
        .eq("id", input.interviewId)
        .single();

      if (!interviewAccess) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Interview not found" });
      }

      const project = interviewAccess.project as unknown as { organizationId: string };
      const { data: membership } = await ctx.supabase
        .from("organization_members")
        .select("role")
        .eq("organizationId", project.organizationId)
        .eq("userId", ctx.user.id)
        .single();

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      const projAccess = await hasProjectAccess(
        ctx.supabase,
        interviewAccess.projectId,
        ctx.user.id,
      );
      if (!projAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this project",
        });
      }

      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("*, questions(*)")
        .eq("id", input.interviewId)
        .order("order", { referencedTable: "questions", ascending: true })
        .single();

      if (!interview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Interview not found" });
      }

      const { data: profile } = await ctx.supabase
        .from("profiles")
        .select("name, email")
        .eq("id", ctx.user.id)
        .single();

      const questions = (interview.questions ?? []) as { id: string }[];
      const derivedMode = interview.voiceEnabled ? "VOICE" : "CHAT";

      const { data: sessionJson, error } = await ctx.supabase.rpc(
        "create_interview_session",
        {
          p_interview_id: interview.id,
          p_participant_name: profile?.name ?? "Preview User",
          p_participant_email: profile?.email ?? ctx.user.email ?? null,
          p_mode_used: derivedMode,
          p_current_question_id: questions[0]?.id ?? null,
        },
      );

      if (error) {
        log.error("RPC error (createPreview):", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      const session = sessionJson as { id: string };
      return { sessionId: session.id };
    }),

  createFromInvite: publicProcedure
    .input(z.object({ inviteToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Look up candidate + interview via the RPC
      const { data: candidate } = await ctx.supabase
        .from("candidates")
        .select("*, interview:interviews(*, questions(*))")
        .eq("inviteToken", input.inviteToken)
        .single();

      if (!candidate) {
        if (await isRevokedInviteToken(input.inviteToken)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This link has expired. Please ask the recruiter for a new link.",
          });
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite link" });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const interview = candidate.interview as any;
      if (!interview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Interview is no longer available" });
      }

      // Check for link expiration
      if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < Date.now()) {
        if (candidate.sessionId) {
          const { data: existingSession } = await ctx.supabase
            .from("sessions")
            .select("id, status")
            .eq("id", candidate.sessionId)
            .single();
          if (existingSession?.status !== "COMPLETED") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This interview invitation has expired." });
          }
        } else {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This interview invitation has expired." });
        }
      }

      // If session already exists, return it
      if (candidate.sessionId) {
        const { data: existingSession } = await ctx.supabase
          .from("sessions")
          .select("*")
          .eq("id", candidate.sessionId)
          .single();

        if (existingSession) {
          void recordPreflightEvent({
            candidateId: candidate.id as string,
            sessionId: existingSession.id,
            inviteToken: input.inviteToken,
            type: "link_opened",
            status: "done",
          });
          return { sessionId: existingSession.id, interview, isExisting: true };
        }
      }

      // Sort questions
      const questions = (interview.questions ?? []) as { id: string; order: number }[];
      questions.sort((a, b) => a.order - b.order);

      // Create session via RPC (also links it to the candidate)
      const derivedMode = interview.voiceEnabled ? "VOICE" : "CHAT";

      const { data: sessionJson, error } = await ctx.supabase.rpc(
        "create_invite_session",
        {
          p_invite_token: input.inviteToken,
          p_mode_used: derivedMode,
          p_current_question_id: questions[0]?.id ?? null,
        },
      );

      if (error) {
        log.error("RPC error (createFromInvite):", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      const session = sessionJson as { id: string };

      // Point session at candidate object prefix so form CVs + recordings share
      // approve / decline / put-aside purge (B2/local under orgs/.../candidates/{id}/).
      const projectId = interview.projectId as string | undefined;
      if (projectId && candidate.id) {
        const { data: project } = await ctx.supabase
          .from("projects")
          .select("organizationId")
          .eq("id", projectId)
          .maybeSingle();
        if (project?.organizationId) {
          const prefix = candidateMediaPrefix({
            orgId: project.organizationId,
            projectId,
            candidateId: candidate.id as string,
          });
          await ctx.supabase
            .from("sessions")
            .update({ mediaStoragePrefix: prefix })
            .eq("id", session.id);
        }
      }

      void recordPreflightEvent({
        candidateId: candidate.id as string,
        sessionId: session.id,
        inviteToken: input.inviteToken,
        type: "link_opened",
        status: "done",
      });
      return { sessionId: session.id, interview, isExisting: false };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select(
          "*, interview:interviews!inner(*, questions(*)), messages(*)",
        )
        .eq("id", input.id)
        .order("order", {
          referencedTable: "interviews.questions",
          ascending: true,
        })
        .order("timestamp", { referencedTable: "messages", ascending: true })
        .order("id", { referencedTable: "messages", ascending: true })
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Org members get the full record. Anyone else — anonymous, or a dashboard
      // user from another org who happens to have a cookie in this browser — gets
      // exactly the redacted candidate view anonymous access already allows.
      let isMember = false;
      if (ctx.user) {
        const interviewData = session.interview as { projectId?: string } | null;
        if (interviewData?.projectId) {
          const { data: project } = await ctx.supabase
            .from("projects")
            .select("organizationId")
            .eq("id", interviewData.projectId)
            .maybeSingle();
          if (project?.organizationId) {
            isMember = !!(await getOrgMembership(ctx.supabase, project.organizationId, ctx.user.id));
          }
        }
      }
      const current = await expireIfStale(session);
      if (!isMember) return redactSessionForCandidate(current);

      return current;
    }),

  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().min(1),
        contentType: z
          .enum(["TEXT", "AUDIO", "FILE", "IMAGE", "WHITEBOARD"])
          .default("TEXT"),
        questionId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("id, status, startedAt, lastActivityAt, activitySegments, interviewId")
        .eq("id", input.sessionId)
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (
        session.status === "COMPLETED" ||
        session.status === "ABANDONED"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Session is no longer active",
        });
      }

      const { data: userMessage } = await ctx.supabase
        .from("messages")
        .insert({
          sessionId: input.sessionId,
          role: "USER" as const,
          content: input.content,
          contentType: input.contentType,
          questionId: input.questionId ?? null,
          wordCount: input.content.split(/\s+/).length,
        })
        .select()
        .single();

      await ctx.supabase
        .from("sessions")
        .update({ lastActivityAt: new Date().toISOString() })
        .eq("id", input.sessionId);

      return { userMessage };
    }),

  saveWhiteboard: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        drawingId: z.string(),
        label: z.string().optional(),
        snapshotData: z.string(),
        imageDataUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("id")
        .eq("id", input.sessionId)
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { data: existing } = await ctx.supabase
        .from("messages")
        .select("id")
        .eq("sessionId", input.sessionId)
        .eq("contentType", "WHITEBOARD")
        .eq("content", input.drawingId)
        .single();

      const msgData = {
        sessionId: input.sessionId,
        role: "USER" as const,
        content: input.drawingId,
        contentType: "WHITEBOARD" as const,
        whiteboardData: {
          ...JSON.parse(input.snapshotData),
          label: input.label ?? "Drawing",
        },
        ...(input.imageDataUrl
          ? { whiteboardImageUrl: input.imageDataUrl }
          : {}),
      };

      let message;
      if (existing) {
        const { data } = await ctx.supabase
          .from("messages")
          .update(msgData)
          .eq("id", existing.id)
          .select()
          .single();
        message = data;
      } else {
        const { data } = await ctx.supabase
          .from("messages")
          .insert(msgData)
          .select()
          .single();
        message = data;
      }

      return { message };
    }),

  deleteWhiteboard: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        drawingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      await ctx.supabase
        .from("messages")
        .delete()
        .eq("sessionId", input.sessionId)
        .eq("contentType", "WHITEBOARD")
        .eq("content", input.drawingId);

      return { success: true };
    }),

  saveCode: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        snippetId: z.string(),
        label: z.string().optional(),
        snapshotData: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("id")
        .eq("id", input.sessionId)
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { data: existing } = await ctx.supabase
        .from("messages")
        .select("id")
        .eq("sessionId", input.sessionId)
        .eq("contentType", "CODE")
        .eq("content", input.snippetId)
        .single();

      const parsed = JSON.parse(input.snapshotData);
      const msgData = {
        sessionId: input.sessionId,
        role: "USER" as const,
        content: input.snippetId,
        contentType: "CODE" as const,
        whiteboardData: {
          ...parsed,
          label: input.label ?? "Code Snippet",
        },
      };

      let message;
      if (existing) {
        const { data } = await ctx.supabase
          .from("messages")
          .update(msgData)
          .eq("id", existing.id)
          .select()
          .single();
        message = data;
      } else {
        const { data } = await ctx.supabase
          .from("messages")
          .insert(msgData)
          .select()
          .single();
        message = data;
      }

      return { message };
    }),

  deleteCode: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        snippetId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      await ctx.supabase
        .from("messages")
        .delete()
        .eq("sessionId", input.sessionId)
        .eq("contentType", "CODE")
        .eq("content", input.snippetId);

      return { success: true };
    }),

  updateCurrentQuestion: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        questionId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.sessionId);
      await ctx.supabase
        .from("sessions")
        .update({
          currentQuestionId: input.questionId,
          lastActivityAt: new Date().toISOString(),
        })
        .eq("id", input.sessionId);
      return { success: true };
    }),

  complete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertNotDisqualified(ctx.supabase, input.id);
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("id, startedAt")
        .eq("id", input.id)
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { data: firstMsg } = await ctx.supabase
        .from("messages")
        .select("timestamp")
        .eq("sessionId", input.id)
        .order("timestamp", { ascending: true })
        .limit(1)
        .single();

      const actualStart = firstMsg?.timestamp
        ? new Date(firstMsg.timestamp).getTime()
        : new Date(session.startedAt).getTime();
      const now = new Date();
      const duration = Math.round((now.getTime() - actualStart) / 1000);

      await ctx.supabase
        .from("sessions")
        .update({
          status: "COMPLETED" as const,
          completedAt: now.toISOString(),
          startedAt: new Date(actualStart).toISOString(),
          totalDurationSeconds: duration,
        })
        .eq("id", input.id)
        .neq("status", "DISQUALIFIED");

      // Fire-and-forget WhatsApp alert to assigned team members
      void import("../completion-notify").then(({ notifySessionCompleted }) =>
        notifySessionCompleted(ctx.supabase, input.id),
      );

      return { success: true };
    }),

  reportAntiCheatingViolation: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        violation: z.object({
          type: z.enum(["page_departure", "paste", "multi_screen", "tab_switch", "focus_lost", "copy", "cut", "head_movement"]),
          timestamp: z.number(),
          detail: z.string().max(500).optional(),
          imageUrl: z.string().max(2000).optional(),
          imagePath: z.string().max(500).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select("antiCheatingLog, status, interviewId")
        .eq("id", input.sessionId)
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      const prevLog = Array.isArray(session.antiCheatingLog) ? session.antiCheatingLog : [];

      if (session.status === "DISQUALIFIED") {
        const strikes = countStrikes(prevLog);
        return { success: true, strikes, headViolations: strikes, disqualified: true };
      }
      // Anti-cheating must be on for violations to count toward disqualification.
      const { data: ivAc } = await ctx.supabase
        .from("interviews")
        .select("antiCheatingEnabled")
        .eq("id", session.interviewId)
        .single();
      const antiCheatingOn = !!ivAc?.antiCheatingEnabled;

      let headDetectionOn = false;
      if (input.violation.type === "head_movement") {
        const { data: iv } = await ctx.supabase
          .from("interviews")
          .select("antiCheatingEnabled, headMovementDetectionEnabled")
          .eq("id", session.interviewId)
          .single();
        headDetectionOn = !!(iv?.antiCheatingEnabled && iv?.headMovementDetectionEnabled);
        if (!headDetectionOn) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Head movement detection is not enabled for this interview" });
        }
      }

      const result = applyAntiCheatingViolation(prevLog, input.violation);
      const disqualify = antiCheatingOn && result.disqualify;
      const log = disqualify ? result.log : result.log.filter((v) => (v as { type?: string }).type !== "disqualified");

      const update: Record<string, unknown> = { antiCheatingLog: log };
      if (disqualify) {
        void recordSessionError({
          sessionId: input.sessionId,
          category: "anti_cheat",
          severity: "warning",
          source: "anti-cheat",
          message: `Interview ended automatically: candidate disqualified after ${result.strikes} anti-cheating strikes (last: ${input.violation.type}).`,
          code: "DISQUALIFIED",
          context: { strikes: result.strikes, lastViolation: input.violation.type },
        });
        update.status = "DISQUALIFIED";
        update.completedAt = new Date().toISOString();
      }

      await ctx.supabase
        .from("sessions")
        .update(update)
        .eq("id", input.sessionId);

      // headViolations kept for older clients; it now carries the shared strike count.
      return { success: true, strikes: result.strikes, headViolations: result.strikes, disqualified: disqualify };
    }),

  listAll: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(["IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"])
          .optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get interviews accessible via org membership
      const { data: memberships } = await ctx.supabase
        .from("organization_members")
        .select("organizationId")
        .eq("userId", ctx.user.id);

      const orgIds = (memberships ?? []).map(
        (m: { organizationId: string }) => m.organizationId,
      );
      if (orgIds.length === 0) return { sessions: [] };

      const { data: projects } = await ctx.supabase
        .from("projects")
        .select("id")
        .in("organizationId", orgIds);

      const allProjIds = (projects ?? []).map((p: { id: string }) => p.id);
      const projectIds = await filterAccessibleProjectIds(ctx.supabase, allProjIds, ctx.user.id);
      if (projectIds.length === 0) return { sessions: [] };

      const { data: userInterviews } = await ctx.supabase
        .from("interviews")
        .select("id")
        .in("projectId", projectIds);

      const interviewIds = (userInterviews ?? []).map((i: { id: string }) => i.id);
      if (interviewIds.length === 0) return { sessions: [] };

      let query = ctx.supabase
        .from("sessions")
        .select(
          "*, interview:interviews!inner(id, title, chatEnabled, voiceEnabled, videoEnabled), messages(id)",
        )
        .in("interviewId", interviewIds)
        .order("createdAt", { ascending: false })
        .limit(input.limit);

      if (input.status) {
        query = query.eq("status", input.status);
      }

      const { data: raw } = await query;

      const mapped = (raw ?? []).map((s) => ({
        ...s,
        _count: {
          messages: (s.messages as { id: string }[])?.length ?? 0,
        },
      }));
      const sessions = await expireSessionsIfStale(mapped);

      return { sessions };
    }),

  listByInterview: protectedProcedure
    .input(
      z.object({
        interviewId: z.string(),
        status: z
          .enum(["IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"])
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("id, projectId, project:projects!inner(organizationId)")
        .eq("id", input.interviewId)
        .single();

      if (!interview) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const project = interview.project as unknown as { organizationId: string };
      const { data: membership } = await ctx.supabase
        .from("organization_members")
        .select("role")
        .eq("organizationId", project.organizationId)
        .eq("userId", ctx.user.id)
        .single();

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
      }

      const limit = input.limit;

      let query = ctx.supabase
        .from("sessions")
        .select("*, messages(id)")
        .eq("interviewId", input.interviewId)
        .is("dataArchivedAt", null)
        .order("createdAt", { ascending: false })
        .limit(limit + 1);

      if (input.status) {
        query = query.eq("status", input.status);
      }

      const { data: raw } = await query;
      const rows = raw ?? [];

      const mapped = rows.slice(0, limit).map((s) => ({
        ...s,
        _count: {
          messages: (s.messages as { id: string }[])?.length ?? 0,
        },
      }));
      const sessions = await expireSessionsIfStale(mapped);

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        nextCursor = rows[limit - 1].id;
      }

      return { sessions, nextCursor };
    }),

  /** Archived rows: candidate name and score only. Files and transcript are already gone. */
  listHistory: protectedProcedure
    .input(z.object({ interviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("id, projectId, project:projects!inner(organizationId)")
        .eq("id", input.interviewId)
        .single();
      if (!interview) throw new TRPCError({ code: "NOT_FOUND" });
      const project = interview.project as unknown as { organizationId: string };
      const { data: membership } = await ctx.supabase
        .from("organization_members")
        .select("role")
        .eq("organizationId", project.organizationId)
        .eq("userId", ctx.user.id)
        .single();
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) throw new TRPCError({ code: "FORBIDDEN" });

      const { data } = await ctx.supabase
        .from("sessions")
        .select("id, participantName, participantEmail, status, insights, dataArchivedAt, createdAt")
        .eq("interviewId", input.interviewId)
        .not("dataArchivedAt", "is", null)
        .order("dataArchivedAt", { ascending: false })
        .limit(200);

      return {
        sessions: (data ?? []).map((row) => ({
          id: row.id as string,
          participantName: (row.participantName as string | null) ?? null,
          participantEmail: (row.participantEmail as string | null) ?? null,
          status: row.status as string,
          insights: row.insights ?? null,
          dataArchivedAt: row.dataArchivedAt as string,
          createdAt: row.createdAt as string,
        })),
      };
    }),

  /** Remove files and transcript. Keep name and score for History. */
  archiveMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const { data: sessions } = await ctx.supabase
        .from("sessions")
        .select(
          "id, participantName, participantEmail, mediaStoragePrefix, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
        )
        .in("id", input.ids);

      const { data: linked } = await ctx.supabase
        .from("candidates")
        .select("sessionId, name, email")
        .in("sessionId", input.ids);
      const candidateBySession = new Map(
        (linked ?? []).map((c) => [c.sessionId as string, c]),
      );

      let cleared = 0;
      for (const s of sessions ?? []) {
        const interviewData = s.interview as unknown as {
          projectId: string;
          project: { organizationId: string };
        };
        const orgId = interviewData?.project?.organizationId;
        if (!orgId) throw new TRPCError({ code: "NOT_FOUND" });
        const { data: membership } = await ctx.supabase
          .from("organization_members")
          .select("role")
          .eq("organizationId", orgId)
          .eq("userId", ctx.user.id)
          .single();
        if (!membership) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to delete this interview data" });
        }
        const projAccess = await hasProjectAccess(ctx.supabase, interviewData.projectId, ctx.user.id);
        if (!projAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to delete this interview data" });
        }
        const linkedCandidate = candidateBySession.get(s.id as string);
        if (linkedCandidate && !s.participantName) {
          await ctx.supabase
            .from("sessions")
            .update({
              participantName: linkedCandidate.name,
              participantEmail: (s.participantEmail as string | null) ?? linkedCandidate.email,
            })
            .eq("id", s.id);
        }
        const result = await archiveSessionData(ctx.supabase, s.id as string, s.mediaStoragePrefix as string | null);
        cleared += result.cleared;
      }
      return { archived: sessions?.length ?? 0, cleared };
    }),

  saveRecording: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        audioRecordingUrl: z.string().optional(),
        audioDuration: z.number().optional(),
        screenshots: z
          .array(
            z.object({
              url: z.string(),
              path: z.string(),
              timestamp: z.string(),
              type: z.enum(["camera", "screen"]),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Media finalize must work after complete/disqualify (end race + strike DQ).
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select(
          "id, status, mediaClearedAt, interview:interviews!inner(project:projects!inner(organizationId))",
        )
        .eq("id", input.sessionId)
        .maybeSingle();

      const status = session?.status as string | undefined;
      const allowed =
        status === "IN_PROGRESS" ||
        status === "COMPLETED" ||
        status === "DISQUALIFIED";
      if (!session || !allowed || (session as { mediaClearedAt?: string | null }).mediaClearedAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This interview session is not available.",
        });
      }

      const interviewRaw = session.interview as unknown;
      const interview = (
        Array.isArray(interviewRaw) ? interviewRaw[0] : interviewRaw
      ) as {
        project: { organizationId: string } | { organizationId: string }[];
      } | null;
      const projectRaw = interview?.project;
      const project = (
        Array.isArray(projectRaw) ? projectRaw[0] : projectRaw
      ) as { organizationId: string } | null;
      const organizationId = project?.organizationId;
      if (!organizationId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Session is missing organization context.",
        });
      }

      const { pathBelongsToSession, objectPathFromSignedUrl } = await import(
        "@/lib/tenant-storage"
      );

      const updateData: Record<string, unknown> = {};
      if (input.audioRecordingUrl) {
        const audioPath =
          objectPathFromSignedUrl("recordings", input.audioRecordingUrl) ??
          input.audioRecordingUrl.split("?")[0];
        if (
          !pathBelongsToSession(audioPath, input.sessionId, organizationId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Recording path does not match this session.",
          });
        }
        updateData.audioRecordingUrl = input.audioRecordingUrl;
      }
      if (input.audioDuration !== undefined) {
        updateData.audioDuration = input.audioDuration;
      }
      if (input.screenshots) {
        for (const shot of input.screenshots) {
          if (
            !pathBelongsToSession(shot.path, input.sessionId, organizationId)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Screenshot path does not match this session.",
            });
          }
        }
        updateData.screenshots = input.screenshots;
      }

      if (Object.keys(updateData).length === 0) {
        return { success: true };
      }

      const { error } = await ctx.supabase
        .from("sessions")
        .update(updateData)
        .eq("id", input.sessionId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }

      return { success: true };
    }),

  /** Approve / decline / put-aside session media. Decline clears object storage; DB scores stay. */
  setMediaReview: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        action: z.enum(["approved", "declined", "set_aside"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select(
          "id, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
        )
        .eq("id", input.sessionId)
        .single();

      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const interviewData = session.interview as unknown as {
        projectId: string;
        project: { organizationId: string };
      };
      const membership = await getOrgMembership(
        ctx.supabase,
        interviewData.project.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }
      const projAccess = await hasProjectAccess(
        ctx.supabase,
        interviewData.projectId,
        ctx.user.id,
      );
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access to this project" });
      }

      return applyMediaReview(ctx.supabase, input.sessionId, input.action);
    }),

  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { data: sessions } = await ctx.supabase
        .from("sessions")
        .select(
          "id, mediaStoragePrefix, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
        )
        .in("id", input.ids);

      await Promise.all(
        (sessions ?? []).map(async (s) => {
          const interviewData = s.interview as unknown as {
            projectId: string;
            project: { organizationId: string };
          };
          const orgId = interviewData?.project?.organizationId;
          if (!orgId) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          const { data: membership } = await ctx.supabase
            .from("organization_members")
            .select("role")
            .eq("organizationId", orgId)
            .eq("userId", ctx.user.id)
            .single();

          if (!membership) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Not authorized to delete these sessions",
            });
          }

          const projAccess = await hasProjectAccess(ctx.supabase, interviewData.projectId, ctx.user.id);
          if (!projAccess) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Not authorized to delete these sessions",
            });
          }

          // Wipe object storage before DB delete
          await clearSessionMediaStorage(ctx.supabase, s.id, s.mediaStoragePrefix).catch((err) => {
            log.warn("media clear on delete failed", s.id, err);
          });
        }),
      );

      await ctx.supabase.from("sessions").delete().in("id", input.ids);

      return { deleted: input.ids.length };
    }),
});
