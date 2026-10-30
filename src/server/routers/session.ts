import { applyAntiCheatingViolation, countHeadViolations } from "@/lib/head-movement";
import { createLogger } from "@/lib/logger";
import { applyMediaReview, clearSessionMediaStorage } from "@/lib/media-review";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { filterAccessibleProjectIds, getOrgMembership, hasProjectAccess, protectedProcedure, publicProcedure, router } from "../trpc";

const log = createLogger("router/session");

export const sessionRouter = router({
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
        .eq("workspaceId", project.organizationId)
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
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // If caller is authenticated user, verify tenant organization membership
      if (ctx.user) {
        const interviewData = session.interview as { projectId?: string } | null;
        if (interviewData?.projectId) {
          const { data: project } = await ctx.supabase
            .from("projects")
            .select("organizationId")
            .eq("id", interviewData.projectId)
            .maybeSingle();
          if (project?.organizationId) {
            const membership = await getOrgMembership(ctx.supabase, project.organizationId, ctx.user.id);
            if (!membership) {
              throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this session" });
            }
          }
        }
      } else {
        // Redact internal assessment details, scoring rubrics, and interviewer-only data for unauthenticated candidate access
        const interview = session.interview as Record<string, unknown> | null;
        const safeInterview = interview
          ? {
              ...interview,
              systemPrompt: undefined,
              prompt: undefined,
              invitedEmails: undefined,
              assessmentCriteria: undefined,
              scoringRubric: undefined,
            }
          : null;

        return {
          ...session,
          summary: undefined,
          insights: undefined,
          themes: undefined,
          sentiment: undefined,
          antiCheatingLog: undefined,
          activitySegments: undefined,
          interview: safeInterview,
        };
      }

      return session;
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
        return { success: true, headViolations: countHeadViolations(prevLog), disqualified: true };
      }

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

      const update: Record<string, unknown> = { antiCheatingLog: result.log };
      if (result.disqualify) {
        update.status = "DISQUALIFIED";
        update.completedAt = new Date().toISOString();
      }

      await ctx.supabase
        .from("sessions")
        .update(update)
        .eq("id", input.sessionId);

      return { success: true, headViolations: result.headViolations, disqualified: result.disqualify };
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
        .select("workspaceId")
        .eq("userId", ctx.user.id);

      const orgIds = (memberships ?? []).map(
        (m: { workspaceId: string }) => m.workspaceId,
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

      const sessions = (raw ?? []).map((s) => ({
        ...s,
        _count: {
          messages: (s.messages as { id: string }[])?.length ?? 0,
        },
      }));

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
        .eq("workspaceId", project.organizationId)
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
        .order("createdAt", { ascending: false })
        .limit(limit + 1);

      if (input.status) {
        query = query.eq("status", input.status);
      }

      const { data: raw } = await query;
      const rows = raw ?? [];

      const sessions = rows.slice(0, limit).map((s) => ({
        ...s,
        _count: {
          messages: (s.messages as { id: string }[])?.length ?? 0,
        },
      }));

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        nextCursor = rows[limit - 1].id;
      }

      return { sessions, nextCursor };
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
      const updateData: Record<string, unknown> = {};
      if (input.audioRecordingUrl) {
        updateData.audioRecordingUrl = input.audioRecordingUrl;
      }
      if (input.audioDuration !== undefined) {
        updateData.audioDuration = input.audioDuration;
      }
      if (input.screenshots) {
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
            .eq("workspaceId", orgId)
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
