import { supabaseAdmin } from "@/lib/supabase/admin";
import { effectiveDurationSeconds, lastMessageAt } from "@/lib/session-activity";
import { assessIntegrity, type IntegritySignal } from "@/lib/integrity/signals";
import {
  objectPathFromSignedUrl,
  pathBelongsToSession,
  type SessionStorageScope,
} from "@/lib/tenant-storage";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getOrgMembership, hasProjectAccess, protectedProcedure, router } from "../trpc";

interface ScreenshotEntry {
  url: string;
  path: string;
  timestamp: string;
  type: "camera" | "screen";
}

/** The session's project + media folder, which bound the storage paths it may reference. */
export async function loadSessionStorageScope(sessionId: string): Promise<SessionStorageScope> {
  const { data } = await supabaseAdmin
    .from("sessions")
    .select("mediaStoragePrefix, interview:interviews!inner(projectId)")
    .eq("id", sessionId)
    .maybeSingle();
  const row = data as { mediaStoragePrefix?: string | null; interview?: { projectId?: string | null } | null } | null;
  return {
    projectId: row?.interview?.projectId ?? null,
    mediaStoragePrefix: row?.mediaStoragePrefix ?? null,
  };
}

/**
 * Re-sign only when the object path is owned by this session (its project and
 * media folder). Prevents a poisoned path/URL from minting access to another
 * tenant's, project's, or candidate's media. Returns null when it can't sign;
 * callers must then drop the URL rather than fall back to the stored value.
 */
export async function resolveSessionSignedUrl(
  bucket: string,
  urlOrPath: string,
  sessionId: string,
  organizationId: string,
  scope?: SessionStorageScope,
): Promise<string | null> {
  const objectPath =
    objectPathFromSignedUrl(bucket, urlOrPath) ??
    (urlOrPath.includes("/") || !urlOrPath.includes("://")
      ? urlOrPath.replace(/^\/+/, "").split("?")[0]
      : null);
  if (!objectPath) return null;
  const sessionScope = scope ?? (await loadSessionStorageScope(sessionId));
  if (!pathBelongsToSession(objectPath, sessionId, organizationId, sessionScope)) {
    return null;
  }
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60 * 60 * 24); // 24 hours
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export const analysisRouter = router({
  getSessionSummary: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select(
          `*, interview:interviews!inner(userId, title, objective, language, projectId, project:projects!inner(organizationId)), messages(*)`,
        )
        .eq("id", input.sessionId)
        .order("timestamp", { referencedTable: "messages", ascending: true })
        .order("id", { referencedTable: "messages", ascending: true })
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const interview = session.interview as {
        userId: string;
        title: string;
        objective: string | null;
        language?: string | null;
        projectId: string;
        project: { organizationId: string };
      };

      const membership = await getOrgMembership(ctx.supabase, interview.project.organizationId, ctx.user.id);
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
      }

      const organizationId = interview.project.organizationId;
      const mediaClearedAt = (session as { mediaClearedAt?: string | null }).mediaClearedAt ?? null;
      const scope: SessionStorageScope = {
        projectId: interview.projectId,
        mediaStoragePrefix: (session as { mediaStoragePrefix?: string | null }).mediaStoragePrefix ?? null,
      };

      // Fresh signed URLs only; stored client-supplied URLs are never echoed back.
      let audioRecordingUrl: string | null = null;
      if (!mediaClearedAt && session.audioRecordingUrl) {
        audioRecordingUrl = await resolveSessionSignedUrl(
          "recordings",
          session.audioRecordingUrl as string,
          input.sessionId,
          organizationId,
          scope,
        );
      }

      let screenshots: ScreenshotEntry[] | null = null;
      const rawScreenshots = session.screenshots as ScreenshotEntry[] | null;
      if (!mediaClearedAt && rawScreenshots && rawScreenshots.length > 0) {
        const signedShots = await Promise.all(
          rawScreenshots.map(async (s) => {
            const signed = s?.path
              ? await resolveSessionSignedUrl("screenshots", s.path, input.sessionId, organizationId, scope)
              : null;
            return signed ? { ...s, url: signed } : null;
          }),
        );
        screenshots = signedShots.filter((s): s is ScreenshotEntry => s !== null);
      }

      type StrikeLog = {
        type: string;
        timestamp: number;
        detail?: string;
        imageUrl?: string;
        imagePath?: string;
        screenImageUrl?: string;
        screenImagePath?: string;
        displayInfo?: unknown;
        evidence?: unknown;
        narrative?: string;
      };
      const rawLog = ((session as Record<string, unknown>).antiCheatingLog ?? null) as
        | StrikeLog[]
        | null;
      let antiCheatingLog: StrikeLog[] | null = rawLog;
      if (rawLog?.length) {
        antiCheatingLog = await Promise.all(
          rawLog.map(async (v) => {
            const { imageUrl: _cam, screenImageUrl: _screen, ...rest } = v;
            if (mediaClearedAt) return rest;
            const camSource = v.imagePath || v.imageUrl;
            const screenSource = v.screenImagePath || v.screenImageUrl;
            const [camSigned, screenSigned] = await Promise.all([
              camSource
                ? resolveSessionSignedUrl("screenshots", camSource, input.sessionId, organizationId, scope)
                : Promise.resolve(null),
              screenSource
                ? resolveSessionSignedUrl("screenshots", screenSource, input.sessionId, organizationId, scope)
                : Promise.resolve(null),
            ]);
            return {
              ...rest,
              ...(camSigned ? { imageUrl: camSigned } : {}),
              ...(screenSigned ? { screenImageUrl: screenSigned } : {}),
            };
          }),
        );
      }

      const rawSignals = (session as Record<string, unknown>).integritySignals;
      const integritySignals = (Array.isArray(rawSignals) ? rawSignals : []) as IntegritySignal[];

      return {
        organizationId,
        interviewTitle: interview.title,
        interviewObjective: interview.objective,
        interviewLanguage: interview.language ?? null,
        participantName: session.participantName,
        participantEmail: session.participantEmail,
        candidateId: ((session as { candidateId?: string | null }).candidateId ?? null) as string | null,
        status: session.status,
        createdAt: session.createdAt,
        summary: session.summary,
        reportStatus: (session as { reportStatus?: string | null }).reportStatus ?? null,
        reportError: (session as { reportError?: string | null }).reportError ?? null,
        reportStartedAt: (session as { reportStartedAt?: string | null }).reportStartedAt ?? null,
        completedAt: (session as { completedAt?: string | null }).completedAt ?? null,
        insights: session.insights,
        themes: session.themes,
        sentiment: session.sentiment,
        messages: session.messages,
        totalDurationSeconds: effectiveDurationSeconds(
          session as never,
          lastMessageAt((session.messages ?? []) as { role: string; timestamp?: string }[]),
        ),
        lastHeartbeatAt: (session as { lastHeartbeatAt?: string | null }).lastHeartbeatAt ?? null,
        interviewBeganAt: (session as { interviewBeganAt?: string | null }).interviewBeganAt ?? null,
        audioRecordingUrl,
        audioDuration: (session as Record<string, unknown>).audioDuration as number | null,
        screenshots,
        antiCheatingLog,
        integritySignals,
        integrity: integritySignals.length ? assessIntegrity(integritySignals, rawLog ?? []) : null,
        mediaReviewStatus:
          (session as { mediaReviewStatus?: string | null }).mediaReviewStatus ?? "pending",
        mediaExpiresAt: (session as { mediaExpiresAt?: string | null }).mediaExpiresAt ?? null,
        mediaClearedAt,
        doubtful: (session as { integrityDoubtfulAt?: string | null }).integrityDoubtfulAt
          ? {
              at: (session as { integrityDoubtfulAt: string }).integrityDoubtfulAt,
              remark: (session as { integrityDoubtfulRemark?: string | null }).integrityDoubtfulRemark ?? "",
              by: (session as { integrityDoubtfulBy?: string | null }).integrityDoubtfulBy ?? null,
            }
          : null,
      };
    }),

  getInterviewInsights: protectedProcedure
    .input(z.object({ interviewId: z.string() }))
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
      const membership = await getOrgMembership(ctx.supabase, project.organizationId, ctx.user.id);
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
      }

      const { data: sessions } = await ctx.supabase
        .from("sessions")
        .select("participantEmail, totalDurationSeconds, themes, messages(id)")
        .eq("interviewId", input.interviewId)
        .eq("status", "COMPLETED");

      const completedSessions = sessions ?? [];
      const totalSessions = completedSessions.length;
      const avgDuration =
        totalSessions > 0
          ? completedSessions.reduce(
              (sum, s) => sum + (s.totalDurationSeconds ?? 0),
              0,
            ) / totalSessions
          : 0;

      const totalMessages = completedSessions.reduce(
        (sum, s) => sum + ((s.messages as { id: string }[])?.length ?? 0),
        0,
      );

      const uniqueEmails = new Set(
        completedSessions
          .map((s) => s.participantEmail)
          .filter((e): e is string => !!e),
      );

      const allThemes = completedSessions.flatMap((s) => s.themes ?? []);
      const themeCounts: Record<string, number> = {};
      for (const theme of allThemes) {
        themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
      }

      return {
        totalSessions,
        totalMessages,
        totalParticipants: uniqueEmails.size,
        avgDurationSeconds: Math.round(avgDuration),
        topThemes: Object.entries(themeCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10),
      };
    }),
});
