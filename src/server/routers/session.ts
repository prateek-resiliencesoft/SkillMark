import { expireIfStale, expireSessionsIfStale, isRevokedInviteToken } from "@/lib/session-link-server";
import { recordPreflightEvent } from "@/lib/preflight-server";
import {
  MAX_STRIKES,
  STRIKE_LABEL,
  STRIKE_TYPES,
  applyAntiCheatingViolation,
  countStrikes,
  disqualificationRemark,
  type LoggedViolation,
} from "@/lib/head-movement";
import { INTEGRITY_SIGNAL_TYPES, mergeIntegritySignals, type IntegritySignal } from "@/lib/integrity/signals";
import { effectiveIntegrityConfig } from "@/lib/integrity/config";
import { createLogger } from "@/lib/logger";
import { applyMediaReview, archiveSessionData } from "@/lib/media-review";
import { setCandidateDecisionStatus } from "../candidate-decision";
import { sendApprovalShortlist, sendDeclineRejection } from "../decline-rejection";
import { deleteSessionWithData } from "@/lib/candidate-data-deletion";
import { candidateMediaPrefix } from "@/lib/storage-paths";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { redactSessionForCandidate } from "@/lib/session-redact";
import { inviteSessionAction } from "@/lib/session-link";
import { ERROR_CATEGORIES, ERROR_SEVERITIES, createClientErrorLimiter, summarizeErrorLog, type SessionErrorEntry } from "@/lib/session-error-log";
import { recordSessionError } from "@/lib/session-error-log-server";
import { issueSessionCapabilityCookie, readSessionCapabilityCookie, sessionCapabilityOk } from "@/lib/session-capability";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import {
  assertMinRole,
  filterAccessibleProjectIds,
  getEffectiveProjectRole,
  getOrgMembership,
  hasProjectAccess,
  protectedProcedure,
  publicProcedure,
  router,
  type MemberRole,
} from "../trpc";
import type { Context } from "../context";
import { devanagariToRoman } from "@/lib/transcript/transliterate";

const log = createLogger("router/session");

type Db = Context["supabase"];

/** Per-session caps on candidate-written artifacts (DB rows, report prompt size). */
export const SESSION_LIMITS = {
  messageChars: 20_000,
  messagesPerSession: 3_000,
  artifactId: 100,
  label: 200,
  whiteboardSnapshotChars: 2_000_000,
  whiteboardImageChars: 3_000_000,
  codeSnapshotChars: 256_000,
  drawingsPerSession: 30,
  snippetsPerSession: 30,
  screenshotsPerSave: 200,
} as const;

/** Client error reports after the end screen (e.g. the final recording save failed) stay useful briefly. */
const CLIENT_ERROR_GRACE_MS = 15 * 60 * 1000;
/** saveRecording may finish after complete / strike-disqualification, but not indefinitely. */
const RECORDING_FINALIZE_GRACE_MS = 60 * 60 * 1000;

const CLIENT_ERROR_CATEGORIES = new Set<string>(["client", "voice", "tts_stt"]);
const SERVER_CONTEXT_KEYS = new Set(["failover", "keySource", "keySlot", "recoveredBy", "originalCategory"]);

const allowClientErrorReport = createClientErrorLimiter();
const allowCandidateWrite = createClientErrorLimiter(120, 6000);
const allowIntegrityBatch = createClientErrorLimiter(20, 600);
const allowViolationReport = createClientErrorLimiter(30, 300);

function rateLimited(allowed: boolean) {
  if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests for this session. Slow down." });
}

const SESSION_GUARD_COLUMNS = "id, status, supersededAt, dataArchivedAt, capabilityRequired, interviewBeganAt, completedAt, interviewId";

type GuardedSession = {
  id: string;
  status: string;
  supersededAt?: string | null;
  dataArchivedAt?: string | null;
  capabilityRequired?: boolean | null;
  interviewBeganAt?: string | null;
  completedAt?: string | null;
  interviewId?: string;
  [k: string]: unknown;
};

function isLiveSession(s: GuardedSession): boolean {
  return s.status === "IN_PROGRESS" && !s.supersededAt && !s.dataArchivedAt;
}

/** The session UUID alone is not a credential: sessions handed out after 39-session-capability require the cookie. */
async function assertSessionCapability(session: { id: string; capabilityRequired?: boolean | null }) {
  if (!session.capabilityRequired) return;
  const token = await readSessionCapabilityCookie(session.id);
  if (!sessionCapabilityOk(session, token)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This interview can only be continued in the browser where it was opened.",
    });
  }
}

/** Mark the session as capability-bound and give this caller the cookie. */
async function grantSessionCapability(supabase: Db, sessionId: string) {
  const { error } = await supabase.from("sessions").update({ capabilityRequired: true }).eq("id", sessionId);
  if (error) {
    log.error("could not bind session capability", sessionId, error.message);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not start this interview. Try again." });
  }
  await issueSessionCapabilityCookie(sessionId);
}

async function loadGuardedSession(supabase: Db, sessionId: string, extraColumns = ""): Promise<GuardedSession> {
  const { data } = await supabase
    .from("sessions")
    .select(extraColumns ? `${SESSION_GUARD_COLUMNS}, ${extraColumns}` : SESSION_GUARD_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  const session = data as unknown as GuardedSession;
  await assertSessionCapability(session);
  return session;
}

/**
 * Linked invite deadline. A session whose interview began before the deadline may
 * finish; one that never began (pre-flight) cannot start or answer after it.
 */
async function assertInviteNotExpired(supabase: Db, session: GuardedSession) {
  const { data: cand } = await supabase.from("candidates").select("expiresAt").eq("sessionId", session.id).maybeSingle();
  const expiresAt = cand?.expiresAt ? Date.parse(cand.expiresAt as string) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return;
  const began = session.interviewBeganAt ? Date.parse(session.interviewBeganAt) : NaN;
  if (Number.isFinite(began) && began <= expiresAt) return;
  throw new TRPCError({ code: "BAD_REQUEST", message: "This interview invitation has expired." });
}

/** Candidate write guard: capability, live IN_PROGRESS session (not superseded / archived), unexpired invite. */
async function requireActiveCandidateSession(
  supabase: Db,
  sessionId: string,
  opts: { extraColumns?: string; enforceInviteExpiry?: boolean } = {},
): Promise<GuardedSession> {
  const session = await loadGuardedSession(supabase, sessionId, opts.extraColumns);
  if (session.status === "DISQUALIFIED") {
    throw new TRPCError({ code: "FORBIDDEN", message: "This interview has ended: the session was disqualified." });
  }
  if (!isLiveSession(session)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Session is no longer active" });
  }
  if (opts.enforceInviteExpiry !== false) await assertInviteNotExpired(supabase, session);
  return session;
}

async function countSessionMessages(supabase: Db, sessionId: string, contentType?: string): Promise<number> {
  let q = supabase.from("messages").select("id", { count: "exact", head: true }).eq("sessionId", sessionId);
  if (contentType) q = q.eq("contentType", contentType);
  const { count } = await q;
  return count ?? 0;
}

function parseSnapshot(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid snapshot data" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid snapshot data" });
  }
  return parsed as Record<string, unknown>;
}

/** Recruiter-side session mutations: org member with project access and at least `min` role. */
async function requireSessionManager(
  ctx: { supabase: Db; user: { id: string } },
  organizationId: string,
  projectId: string,
  min: MemberRole = "MEMBER",
): Promise<MemberRole> {
  const membership = await getOrgMembership(ctx.supabase, organizationId, ctx.user.id, { write: true });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  }
  if (!(await hasProjectAccess(ctx.supabase, projectId, ctx.user.id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
  }
  const role = await getEffectiveProjectRole(ctx.supabase, projectId, ctx.user.id, membership.role);
  assertMinRole(role, min);
  return role;
}

/** Caller IP inside a tRPC procedure, or null outside a request (tests, scripts). */
async function requestIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const ip = clientIp({ headers: headers() as unknown as Headers });
    return ip === "unknown" ? null : ip;
  } catch {
    return null;
  }
}

function hasUnsafeSegments(p: string): boolean {
  if (/[\\%\u0000-\u001f]/.test(p)) return true;
  return p.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/**
 * Object keys a candidate may attach to its own session: under the session's
 * assigned media folder (or its session-scoped fallbacks) and the expected kind.
 * Returns the canonical key, or null.
 */
function sessionMediaKey(
  raw: string | null | undefined,
  scope: { sessionId: string; organizationId: string; projectId?: string | null; mediaStoragePrefix?: string | null },
  kind: "recordings" | "images",
  pathBelongsToSession: (
    p: string,
    sid: string,
    org: string,
    s?: { projectId: string | null | undefined; mediaStoragePrefix: string | null | undefined },
  ) => boolean,
): string | null {
  if (!raw) return null;
  const key = raw.replace(/^\/+/, "");
  if (!key || hasUnsafeSegments(key)) return null;
  const roots: string[] = [];
  const prefix = scope.mediaStoragePrefix?.replace(/\/+$/, "");
  if (prefix && !hasUnsafeSegments(prefix) && prefix.startsWith(`orgs/${scope.organizationId}/`)) roots.push(`${prefix}/${kind}/`);
  if (scope.projectId) {
    roots.push(`orgs/${scope.organizationId}/projects/${scope.projectId}/candidates/session-${scope.sessionId}/${kind}/`);
  }
  roots.push(`org/${scope.organizationId}/sessions/${scope.sessionId}/`);
  if (!roots.some((r) => key.startsWith(r) && key.length > r.length)) return null;
  return pathBelongsToSession(key, scope.sessionId, scope.organizationId, {
    projectId: scope.projectId,
    mediaStoragePrefix: scope.mediaStoragePrefix,
  })
    ? key
    : null;
}

/**
 * Keep a client-sent signed URL only when it is our /api/files URL for exactly the
 * validated key, reduced to its same-origin relative form (any client host is dropped).
 */
function urlForKey(
  url: string | null | undefined,
  key: string,
  bucket: string,
  objectPathFromSignedUrl: (bucket: string, url: string) => string | null,
): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url, "http://local.invalid");
  } catch {
    return undefined;
  }
  if (!u.pathname.startsWith(`/api/files/${bucket}/`)) return undefined;
  const rel = `${u.pathname}${u.search}`;
  return objectPathFromSignedUrl(bucket, rel) === key ? rel : undefined;
}

const MAX_VIOLATION_LOG = 500;

type AppendResult = { applied: boolean; status: string; strikes: number; disqualify: boolean; log: unknown[] };

/**
 * Append one strike under a row lock (db/init/41-atomic-strike-append.sql) so parallel
 * reports cannot overwrite each other and slip under the disqualification threshold.
 */
async function appendViolationAtomically(
  supabase: Db,
  sessionId: string,
  violation: LoggedViolation,
  prevLog: unknown[],
): Promise<AppendResult> {
  const { data, error } = await supabase.rpc("append_anti_cheating_violation", {
    p_session_id: sessionId,
    p_violation: violation,
    p_strike_types: Array.from(STRIKE_TYPES),
    p_max_strikes: MAX_STRIKES,
    p_last_label: STRIKE_LABEL[violation.type] ?? violation.type,
    p_max_log: MAX_VIOLATION_LOG,
  });
  if (!error) {
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    const r = data as { applied?: boolean; status?: string; strikes?: number; disqualify?: boolean; log?: unknown[] };
    return {
      applied: !!r.applied,
      status: String(r.status ?? ""),
      strikes: Number(r.strikes ?? 0),
      disqualify: !!r.disqualify,
      log: Array.isArray(r.log) ? r.log : [],
    };
  }
  if (error.code !== "PGRST202" && error.code !== "42883") {
    log.error("append_anti_cheating_violation failed", sessionId, error.message);
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not record this event. Try again." });
  }
  // Migration 40 not applied yet: conditional write that still never touches ended sessions.
  log.warn("append_anti_cheating_violation missing; using non-atomic fallback");
  if (prevLog.length >= MAX_VIOLATION_LOG) {
    return { applied: false, status: "IN_PROGRESS", strikes: countStrikes(prevLog), disqualify: false, log: prevLog };
  }
  const result = applyAntiCheatingViolation(prevLog, violation);
  const update: Record<string, unknown> = { antiCheatingLog: result.log };
  if (result.disqualify) {
    update.status = "DISQUALIFIED";
    update.completedAt = new Date().toISOString();
  }
  const { data: rows } = await supabase
    .from("sessions")
    .update(update)
    .eq("id", sessionId)
    .eq("status", "IN_PROGRESS")
    .select("id");
  const applied = Array.isArray(rows) && rows.length > 0;
  return {
    applied,
    status: applied && result.disqualify ? "DISQUALIFIED" : "IN_PROGRESS",
    strikes: result.strikes,
    disqualify: applied && result.disqualify,
    log: result.log,
  };
}

const integritySignalQueue = new Map<string, Promise<unknown>>();

/** Serialize read-merge-write of integritySignals per session (concurrent batches otherwise drop each other). */
function withIntegrityLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = integritySignalQueue.get(sessionId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  integritySignalQueue.set(sessionId, run);
  void run.finally(() => {
    if (integritySignalQueue.get(sessionId) === run) integritySignalQueue.delete(sessionId);
  }).catch(() => undefined);
  return run;
}

/**
 * Detach an abandoned attempt so create_invite_session makes a fresh one for the
 * same candidate. The old session keeps candidateId (+ supersededAt) for audit.
 */
async function supersedeAbandonedAttempt(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  candidateId: string,
  sessionId: string,
) {
  const now = new Date().toISOString();
  await supabase.from("sessions").update({ candidateId, supersededAt: now }).eq("id", sessionId);
  // ponytail: conditional on sessionId so two tabs can't both detach; the RPC's
  // read-then-insert can still race into two sessions (same as first-open today).
  const { error } = await supabase
    .from("candidates")
    .update({ sessionId: null, updatedAt: now })
    .eq("id", candidateId)
    .eq("sessionId", sessionId);
  if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not restart this interview. Try again." });
}

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
      const s = await loadGuardedSession(ctx.supabase, input.sessionId);
      const endedAt = s.completedAt ? Date.parse(s.completedAt) : NaN;
      const recentlyEnded =
        (s.status === "COMPLETED" || s.status === "DISQUALIFIED") &&
        !s.supersededAt &&
        !s.dataArchivedAt &&
        Number.isFinite(endedAt) &&
        Date.now() - endedAt < CLIENT_ERROR_GRACE_MS;
      if (!isLiveSession(s) && !recentlyEnded) return { ok: false, limited: false };
      // Server-derived context (AI key failover / key source) only comes from server logs.
      const context = Object.fromEntries(
        Object.entries(input.context ?? {}).filter(([k]) => !SERVER_CONTEXT_KEYS.has(k)),
      );
      await recordSessionError(
        {
          sessionId: input.sessionId,
          // Client can't claim server-only categories.
          category: CLIENT_ERROR_CATEGORIES.has(input.category) ? input.category : "client",
          severity: input.severity === "critical" ? "error" : input.severity,
          source: "client",
          message: input.message,
          status: input.status ?? null,
          code: input.code ?? null,
          context,
        },
        { reopenGroups: false },
      );
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
        interviewSlug: z.string().max(200),
        participantName: z.string().max(200).optional(),
        participantEmail: z.string().email().max(320).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = await requestIp();
      if (ip && checkRateLimit(`session:create:${ip}`, 10)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many interviews started. Try again in a minute." });
      }

      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("id, requireInvite, voiceEnabled, questions(id, order)")
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

      // Invite-only: entry is by personal invite token (createFromInvite) only. Uniform
      // answer, no candidates lookup, so the slug is not an invite-list oracle.
      if (interview.requireInvite) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This interview is invite-only. Open the personal link from your invitation.",
        });
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
      await grantSessionCapability(ctx.supabase, session.id);

      return { sessionId: session.id };
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
      await requireSessionManager(ctx, project.organizationId, interviewAccess.projectId as string);

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
      await grantSessionCapability(ctx.supabase, session.id);
      return { sessionId: session.id };
    }),

  createFromInvite: publicProcedure
    .input(z.object({ inviteToken: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // Look up candidate + interview via the RPC
      const { data: candidate } = await ctx.supabase
        .from("candidates")
        .select("id, name, email, expiresAt, sessionId, interview:interviews(id, projectId, voiceEnabled, questions(id, order))")
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

      // If session already exists, return it — unless it was abandoned: then the
      // same link starts a fresh attempt (old one kept for audit, like "Send new link").
      if (candidate.sessionId) {
        const { data: linked } = await ctx.supabase
          .from("sessions")
          .select("*")
          .eq("id", candidate.sessionId)
          .single();
        const existingSession = linked ? await expireIfStale(linked) : null;

        if (existingSession && inviteSessionAction(existingSession.status) === "restart") {
          await supersedeAbandonedAttempt(ctx.supabase, candidate.id as string, existingSession.id as string);
        } else if (existingSession) {
          void recordPreflightEvent({
            candidateId: candidate.id as string,
            sessionId: existingSession.id,
            inviteToken: input.inviteToken,
            type: "link_opened",
            status: "done",
          });
          // One-time link: only a not-yet-begun attempt may be picked up by the link holder.
          if (existingSession.status === "IN_PROGRESS" && !existingSession.interviewBeganAt && !existingSession.supersededAt) {
            await grantSessionCapability(ctx.supabase, existingSession.id as string);
          }
          return { sessionId: existingSession.id as string, isExisting: true };
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
      await grantSessionCapability(ctx.supabase, session.id);

      // Point session at candidate object prefix so form CVs + recordings share
      // approve / decline / put-aside purge (server disk under orgs/.../candidates/{id}/).
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
            candidateName: (candidate as unknown as { name?: string }).name,
            candidateEmail: (candidate as unknown as { email?: string | null }).email ?? null,
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
      return { sessionId: session.id, isExisting: false };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
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

      // Org members with access to the project get the full record. Anyone else —
      // the candidate, or a dashboard user outside this org/project — must hold the
      // session capability and gets the minimal candidate view.
      let isReviewer = false;
      if (ctx.user) {
        const interviewData = session.interview as { projectId?: string } | null;
        if (interviewData?.projectId) {
          const { data: project } = await ctx.supabase
            .from("projects")
            .select("organizationId")
            .eq("id", interviewData.projectId)
            .maybeSingle();
          if (project?.organizationId) {
            isReviewer =
              !!(await getOrgMembership(ctx.supabase, project.organizationId, ctx.user.id)) &&
              (await hasProjectAccess(ctx.supabase, interviewData.projectId, ctx.user.id));
          }
        }
      }
      if (!isReviewer) await assertSessionCapability(session as { id: string; capabilityRequired?: boolean | null });
      const current = await expireIfStale(session);
      if (!isReviewer) return redactSessionForCandidate(current);

      return current;
    }),

  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        content: z.string().min(1).max(SESSION_LIMITS.messageChars),
        contentType: z
          .enum(["TEXT", "AUDIO", "FILE", "IMAGE", "WHITEBOARD"])
          .default("TEXT"),
        questionId: z.string().max(SESSION_LIMITS.artifactId).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      await requireActiveCandidateSession(ctx.supabase, input.sessionId);
      if ((await countSessionMessages(ctx.supabase, input.sessionId)) >= SESSION_LIMITS.messagesPerSession) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This interview has reached its message limit." });
      }

      const { data: userMessage } = await ctx.supabase
        .from("messages")
        .insert({
          sessionId: input.sessionId,
          role: "USER" as const,
          // Hindi is stored as Roman-script Hinglish, never Devanagari.
          content: input.contentType === "TEXT" ? devanagariToRoman(input.content) : input.content,
          contentType: input.contentType,
          questionId: input.questionId ?? null,
          wordCount: input.content.split(/\s+/).length,
        })
        .select()
        .single();

      await ctx.supabase
        .from("sessions")
        .update({ lastActivityAt: new Date().toISOString() })
        .eq("id", input.sessionId)
        .eq("status", "IN_PROGRESS");

      return { userMessage };
    }),

  saveWhiteboard: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        drawingId: z.string().min(1).max(SESSION_LIMITS.artifactId),
        label: z.string().max(SESSION_LIMITS.label).optional(),
        snapshotData: z.string().max(SESSION_LIMITS.whiteboardSnapshotChars),
        // Inline raster/SVG only: this is rasterized and sent to the report LLM.
        imageDataUrl: z
          .string()
          .max(SESSION_LIMITS.whiteboardImageChars)
          .regex(/^data:image\/(svg\+xml|png|jpe?g|webp);base64,/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      const snapshot = parseSnapshot(input.snapshotData);
      await requireActiveCandidateSession(ctx.supabase, input.sessionId);

      const { data: existing } = await ctx.supabase
        .from("messages")
        .select("id")
        .eq("sessionId", input.sessionId)
        .eq("contentType", "WHITEBOARD")
        .eq("content", input.drawingId)
        .maybeSingle();

      if (!existing && (await countSessionMessages(ctx.supabase, input.sessionId, "WHITEBOARD")) >= SESSION_LIMITS.drawingsPerSession) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Drawing limit reached for this interview." });
      }

      const msgData = {
        sessionId: input.sessionId,
        role: "USER" as const,
        content: input.drawingId,
        contentType: "WHITEBOARD" as const,
        whiteboardData: {
          ...snapshot,
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
          .eq("sessionId", input.sessionId)
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
        sessionId: z.string().uuid(),
        drawingId: z.string().min(1).max(SESSION_LIMITS.artifactId),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      await requireActiveCandidateSession(ctx.supabase, input.sessionId);
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
        sessionId: z.string().uuid(),
        snippetId: z.string().min(1).max(SESSION_LIMITS.artifactId),
        label: z.string().max(SESSION_LIMITS.label).optional(),
        snapshotData: z.string().max(SESSION_LIMITS.codeSnapshotChars),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      const parsed = parseSnapshot(input.snapshotData);
      await requireActiveCandidateSession(ctx.supabase, input.sessionId);

      const { data: existing } = await ctx.supabase
        .from("messages")
        .select("id")
        .eq("sessionId", input.sessionId)
        .eq("contentType", "CODE")
        .eq("content", input.snippetId)
        .maybeSingle();

      if (!existing && (await countSessionMessages(ctx.supabase, input.sessionId, "CODE")) >= SESSION_LIMITS.snippetsPerSession) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Code snippet limit reached for this interview." });
      }

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
          .eq("sessionId", input.sessionId)
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
        sessionId: z.string().uuid(),
        snippetId: z.string().min(1).max(SESSION_LIMITS.artifactId),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      await requireActiveCandidateSession(ctx.supabase, input.sessionId);
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
        sessionId: z.string().uuid(),
        questionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      const session = await requireActiveCandidateSession(ctx.supabase, input.sessionId);
      const { data: question } = await ctx.supabase
        .from("questions")
        .select("id")
        .eq("id", input.questionId)
        .eq("interviewId", session.interviewId as string)
        .maybeSingle();
      if (!question) throw new TRPCError({ code: "BAD_REQUEST", message: "Question is not part of this interview" });
      await ctx.supabase
        .from("sessions")
        .update({
          currentQuestionId: input.questionId,
          lastActivityAt: new Date().toISOString(),
        })
        .eq("id", input.sessionId)
        .eq("status", "IN_PROGRESS");
      return { success: true };
    }),

  /**
   * End a live session: the candidate (session capability) or a teammate (MEMBER+
   * with project access) via the results page. Ended sessions are never re-written.
   */
  complete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: row } = await ctx.supabase
        .from("sessions")
        .select(`${SESSION_GUARD_COLUMNS}, startedAt, interview:interviews!inner(projectId, project:projects!inner(organizationId))`)
        .eq("id", input.id)
        .maybeSingle();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const session = row as unknown as GuardedSession & {
        startedAt: string;
        interview: { projectId: string; project: { organizationId: string } };
      };

      let manager = false;
      if (ctx.user && session.interview?.project?.organizationId) {
        const membership = await getOrgMembership(ctx.supabase, session.interview.project.organizationId, ctx.user.id);
        if (membership && (await hasProjectAccess(ctx.supabase, session.interview.projectId, ctx.user.id))) {
          const role = await getEffectiveProjectRole(ctx.supabase, session.interview.projectId, ctx.user.id, membership.role);
          assertMinRole(role, "MEMBER");
          manager = true;
        }
      }
      if (!manager) {
        rateLimited(allowCandidateWrite(input.id));
        await assertSessionCapability(session);
      }

      if (session.status === "DISQUALIFIED") {
        throw new TRPCError({ code: "FORBIDDEN", message: "This interview has ended: the session was disqualified." });
      }
      if (!isLiveSession(session)) return { success: true };

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

      const { data: updated } = await ctx.supabase
        .from("sessions")
        .update({
          status: "COMPLETED" as const,
          completedAt: now.toISOString(),
          startedAt: new Date(actualStart).toISOString(),
          totalDurationSeconds: duration,
        })
        .eq("id", input.id)
        .eq("status", "IN_PROGRESS")
        .is("supersededAt", null)
        .is("dataArchivedAt", null)
        .select("id");
      // Lost the race to another end path (or a strike DQ): no second report / alert.
      if (!Array.isArray(updated) || updated.length === 0) return { success: true };

      // Build the report server-side right away (idempotent, retried).
      void import("@/lib/session-report-server").then(({ scheduleSessionReport }) =>
        scheduleSessionReport(input.id, "completed:manual-end", 0),
      );

      // Fire-and-forget WhatsApp alert to assigned team members
      void import("../completion-notify").then(({ notifySessionCompleted }) =>
        notifySessionCompleted(ctx.supabase, input.id),
      );

      return { success: true };
    }),

  reportAntiCheatingViolation: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        violation: z.object({
          type: z.enum(["page_departure", "paste", "multi_screen", "tab_switch", "focus_lost", "copy", "cut", "head_movement", "offscreen_voice", "device_switch"]),
          timestamp: z.number(),
          detail: z.string().max(500).optional(),
          imageUrl: z.string().max(2000).optional(),
          imagePath: z.string().max(500).optional(),
          screenImageUrl: z.string().max(2000).optional(),
          screenImagePath: z.string().max(500).optional(),
          displayInfo: z
            .object({
              count: z.number().int().min(1).max(16),
              capturedSharedOnly: z.boolean(),
              screens: z
                .array(
                  z.object({
                    label: z.string().max(200).optional(),
                    width: z.number().int().nonnegative(),
                    height: z.number().int().nonnegative(),
                    isPrimary: z.boolean().optional(),
                  }),
                )
                .max(16)
                .optional(),
            })
            .optional(),
          evidence: z
            .object({
              type: z.string().max(200),
              when: z.string().max(100),
              whatDetected: z.string().max(500),
              strikeNumber: z.number().int().min(1).max(20),
              displaysSummary: z.string().max(500),
              evidenceAttached: z.string().max(200),
            })
            .optional(),
          narrative: z.string().max(2000).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowViolationReport(input.sessionId));
      const session = await loadGuardedSession(
        ctx.supabase,
        input.sessionId,
        "antiCheatingLog, mediaStoragePrefix, interview:interviews!inner(projectId, antiCheatingEnabled, headMovementDetectionEnabled, integrityChecksEnabled, project:projects!inner(organizationId))",
      );
      const prevLog = Array.isArray(session.antiCheatingLog) ? (session.antiCheatingLog as unknown[]) : [];

      if (session.status === "DISQUALIFIED") {
        const strikes = countStrikes(prevLog);
        return { success: true, strikes, headViolations: strikes, disqualified: true };
      }
      // Ended, superseded or archived sessions are never re-written (no retroactive DQ).
      if (!isLiveSession(session)) {
        const strikes = countStrikes(prevLog);
        return { success: true, strikes, headViolations: strikes, disqualified: false };
      }

      const iv = session.interview as {
        projectId: string;
        antiCheatingEnabled?: boolean | null;
        headMovementDetectionEnabled?: boolean | null;
        integrityChecksEnabled?: boolean | null;
        project: { organizationId: string };
      };
      if (!iv?.antiCheatingEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Anti-cheating is not enabled for this interview" });
      }
      if (input.violation.type === "head_movement" && !iv.headMovementDetectionEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Head movement detection is not enabled for this interview" });
      }
      if (
        (input.violation.type === "offscreen_voice" || input.violation.type === "device_switch") &&
        !effectiveIntegrityConfig(iv).integrityChecksEnabled
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Integrity checks are not enabled for this interview" });
      }

      // Evidence must be this session's own uploads; client URLs only when they match the key.
      const { pathBelongsToSession, objectPathFromSignedUrl } = await import("@/lib/tenant-storage");
      const scope = {
        sessionId: input.sessionId,
        organizationId: iv.project.organizationId,
        projectId: iv.projectId,
        mediaStoragePrefix: session.mediaStoragePrefix as string | null,
      };
      const violation = { ...input.violation };
      const camKey = sessionMediaKey(violation.imagePath, scope, "images", pathBelongsToSession);
      const screenKey = sessionMediaKey(violation.screenImagePath, scope, "images", pathBelongsToSession);
      violation.imagePath = camKey ?? undefined;
      violation.imageUrl = camKey ? urlForKey(violation.imageUrl, camKey, "images", objectPathFromSignedUrl) : undefined;
      violation.screenImagePath = screenKey ?? undefined;
      violation.screenImageUrl = screenKey
        ? urlForKey(violation.screenImageUrl, screenKey, "images", objectPathFromSignedUrl)
        : undefined;
      const entry = JSON.parse(JSON.stringify(violation)) as typeof violation;

      const applied = await appendViolationAtomically(ctx.supabase, input.sessionId, entry, prevLog);
      if (!applied.applied) {
        return { success: true, strikes: applied.strikes, headViolations: applied.strikes, disqualified: applied.status === "DISQUALIFIED" };
      }

      if (applied.disqualify) {
        void recordSessionError({
          sessionId: input.sessionId,
          category: "anti_cheat",
          severity: "warning",
          source: "anti-cheat",
          message: `Interview ended automatically: candidate disqualified after ${applied.strikes} anti-cheating strikes (last: ${input.violation.type}).`,
          code: "DISQUALIFIED",
          context: { strikes: applied.strikes, lastViolation: input.violation.type },
        });
        // Flag for reviewers with the reason, unless a teammate already marked it doubtful.
        await ctx.supabase
          .from("sessions")
          .update({
            integrityDoubtfulAt: new Date().toISOString(),
            integrityDoubtfulRemark: disqualificationRemark(applied.log),
            integrityDoubtfulBy: "System (automatic)",
          })
          .eq("id", input.sessionId)
          .is("integrityDoubtfulAt", null);
      }

      // headViolations kept for older clients; it now carries the shared strike count.
      return { success: true, strikes: applied.strikes, headViolations: applied.strikes, disqualified: applied.disqualify };
    }),

  /** Current strike count for the candidate's on-screen badge (shown after a reload). */
  getStrikes: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await loadGuardedSession(ctx.supabase, input.sessionId, "antiCheatingLog");
      const log = Array.isArray(session.antiCheatingLog) ? (session.antiCheatingLog as unknown[]) : [];
      return {
        count: countStrikes(log),
        max: MAX_STRIKES,
        disqualified: session.status === "DISQUALIFIED",
      };
    }),

  /** Silent integrity signals (reviewer-only, never strikes), batched by the browser. */
  recordIntegritySignals: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        signals: z
          .array(
            z.object({
              type: z.enum(INTEGRITY_SIGNAL_TYPES),
              timestamp: z.number(),
              value: z.number().finite().optional(),
              detail: z.string().max(300).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowIntegrityBatch(input.sessionId));
      const session = await loadGuardedSession(ctx.supabase, input.sessionId);
      if (!isLiveSession(session)) return { success: true, stored: 0 };

      const { data: iv } = await ctx.supabase
        .from("interviews")
        .select("antiCheatingEnabled, headMovementDetectionEnabled, integrityChecksEnabled")
        .eq("id", session.interviewId as string)
        .single();
      if (!effectiveIntegrityConfig(iv).integrityChecksEnabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Integrity checks are not enabled for this interview" });
      }

      return withIntegrityLock(input.sessionId, async () => {
        const { data: row } = await ctx.supabase
          .from("sessions")
          .select("integritySignals")
          .eq("id", input.sessionId)
          .maybeSingle();
        const prev = (Array.isArray(row?.integritySignals) ? row.integritySignals : []) as IntegritySignal[];
        const next = mergeIntegritySignals(prev, input.signals as IntegritySignal[]);
        await ctx.supabase
          .from("sessions")
          .update({ integritySignals: next })
          .eq("id", input.sessionId)
          .eq("status", "IN_PROGRESS");
        return { success: true, stored: input.signals.length };
      });
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

      // Authorize every session before archiving anything.
      for (const s of sessions ?? []) {
        const interviewData = s.interview as unknown as {
          projectId: string;
          project: { organizationId: string };
        };
        const orgId = interviewData?.project?.organizationId;
        if (!orgId) throw new TRPCError({ code: "NOT_FOUND" });
        await requireSessionManager(ctx, orgId, interviewData.projectId);
      }

      let cleared = 0;
      for (const s of sessions ?? []) {
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
        sessionId: z.string().uuid(),
        audioRecordingUrl: z.string().max(2000).optional(),
        audioDuration: z.number().nonnegative().max(24 * 60 * 60).optional(),
        screenshots: z
          .array(
            z.object({
              url: z.string().max(2000),
              path: z.string().max(500),
              timestamp: z.string().max(64),
              type: z.enum(["camera", "screen"]),
            }),
          )
          .max(SESSION_LIMITS.screenshotsPerSave)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimited(allowCandidateWrite(input.sessionId));
      const session = await loadGuardedSession(
        ctx.supabase,
        input.sessionId,
        "mediaClearedAt, mediaStoragePrefix, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
      );

      // Media finalize must work briefly after complete/disqualify (end race + strike DQ).
      const endedAt = session.completedAt ? Date.parse(session.completedAt) : NaN;
      const inFinalizeWindow =
        (session.status === "COMPLETED" || session.status === "DISQUALIFIED") &&
        Number.isFinite(endedAt) &&
        Date.now() - endedAt < RECORDING_FINALIZE_GRACE_MS;
      const allowed =
        !session.supersededAt &&
        !session.dataArchivedAt &&
        !session.mediaClearedAt &&
        (session.status === "IN_PROGRESS" || inFinalizeWindow);
      if (!allowed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This interview session is not available.",
        });
      }

      const interviewRaw = session.interview as unknown;
      const interview = (
        Array.isArray(interviewRaw) ? interviewRaw[0] : interviewRaw
      ) as {
        projectId?: string | null;
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

      const scope = {
        sessionId: input.sessionId,
        organizationId,
        projectId: interview?.projectId ?? null,
        mediaStoragePrefix: session.mediaStoragePrefix as string | null,
      };

      const updateData: Record<string, unknown> = {};
      if (input.audioRecordingUrl) {
        const audioKey = sessionMediaKey(
          objectPathFromSignedUrl("recordings", input.audioRecordingUrl) ?? input.audioRecordingUrl.split("?")[0],
          scope,
          "recordings",
          pathBelongsToSession,
        );
        if (!audioKey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Recording path does not match this session.",
          });
        }
        // Store the validated object key, never the client-supplied URL.
        updateData.audioRecordingUrl = audioKey;
      }
      if (input.audioDuration !== undefined) {
        updateData.audioDuration = input.audioDuration;
      }
      if (input.screenshots) {
        const shots = input.screenshots.map((shot) => {
          const key = sessionMediaKey(shot.path, scope, "images", pathBelongsToSession);
          if (!key) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Screenshot path does not match this session.",
            });
          }
          return { ...shot, path: key, url: urlForKey(shot.url, key, "images", objectPathFromSignedUrl) ?? "" };
        });
        // Merge with captures the upload route already linked (never drop them).
        const { data: current } = await ctx.supabase
          .from("sessions")
          .select("screenshots")
          .eq("id", input.sessionId)
          .maybeSingle();
        const byPath = new Map<string, unknown>();
        const stored = (current as { screenshots?: unknown } | null)?.screenshots;
        for (const s of Array.isArray(stored) ? (stored as { path?: string }[]) : []) {
          if (s?.path) byPath.set(s.path, s);
        }
        for (const s of shots) byPath.set(s.path, s);
        updateData.screenshots = [...byPath.values()].sort((a, b) =>
          String((a as { timestamp?: string }).timestamp ?? "").localeCompare(
            String((b as { timestamp?: string }).timestamp ?? ""),
          ),
        );
      }

      if (Object.keys(updateData).length === 0) {
        return { success: true };
      }

      const { error } = await ctx.supabase
        .from("sessions")
        .update(updateData)
        .eq("id", input.sessionId)
        .eq("status", session.status)
        .is("mediaClearedAt", null)
        .is("dataArchivedAt", null);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      if (updateData.audioRecordingUrl) {
        void import("@/lib/session-report-server").then(({ onRecordingLinked }) => onRecordingLinked(input.sessionId));
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
          "id, candidateId, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
        )
        .eq("id", input.sessionId)
        .single();

      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      const interviewData = session.interview as unknown as {
        projectId: string;
        project: { organizationId: string };
      };
      await requireSessionManager(ctx, interviewData.project.organizationId, interviewData.projectId);

      const result = await applyMediaReview(ctx.supabase, input.sessionId, input.action);
      const candidateId = (session as { candidateId?: string | null }).candidateId;
      if (input.action === "declined") {
        if (candidateId) await setCandidateDecisionStatus(ctx.supabase, candidateId, "rejected");
        const delivery = await sendDeclineRejection(
          ctx.supabase,
          input.sessionId,
          interviewData.project.organizationId,
        );
        return { ...result, ...delivery };
      }
      if (input.action === "approved") {
        if (candidateId) await setCandidateDecisionStatus(ctx.supabase, candidateId, "approved");
        const delivery = await sendApprovalShortlist(
          ctx.supabase,
          input.sessionId,
          interviewData.project.organizationId,
        );
        return { ...result, ...delivery };
      }
      return result;
    }),

  /** Reviewer-only flag: mark/unmark a session as doubtful with a remark. Informational only. */
  setDoubtful: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        doubtful: z.boolean(),
        remark: z.string().trim().max(1000).optional(),
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

      const iv = session.interview as unknown as {
        projectId: string;
        project: { organizationId: string };
      };
      await requireSessionManager(ctx, iv.project.organizationId, iv.projectId);

      if (input.doubtful && !input.remark) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add a remark explaining the doubt" });
      }

      const update = input.doubtful
        ? {
            integrityDoubtfulAt: new Date().toISOString(),
            integrityDoubtfulRemark: input.remark,
            integrityDoubtfulBy: ctx.user.email ?? "A teammate",
          }
        : { integrityDoubtfulAt: null, integrityDoubtfulRemark: null, integrityDoubtfulBy: null };

      const { error } = await ctx.supabase.from("sessions").update(update).eq("id", input.sessionId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  /** Permanently delete sessions together with their candidate data and stored media. */
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { data: sessions } = await ctx.supabase
        .from("sessions")
        .select(
          "id, status, interview:interviews!inner(projectId, project:projects!inner(organizationId))",
        )
        .in("id", input.ids);

      // Authorize every session before deleting anything. Like candidate.removeMany,
      // a MEMBER may not delete active or completed interviews (ADMIN+ only).
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
          const role = await requireSessionManager(ctx, orgId, interviewData.projectId);
          if (role === "MEMBER" && (s.status === "IN_PROGRESS" || s.status === "COMPLETED")) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot delete active or completed interview sessions. Contact an admin.",
            });
          }
        }),
      );

      let objects = 0;
      let bytes = 0;
      for (const s of sessions ?? []) {
        try {
          const r = await deleteSessionWithData(ctx.supabase, s.id as string);
          objects += r.objects;
          bytes += r.bytes;
        } catch (err) {
          log.error("delete session with data failed", s.id, err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not delete all data for this candidate. Try again.",
          });
        }
      }

      return { deleted: sessions?.length ?? 0, objects, bytes };
    }),
});
