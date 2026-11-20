import { dropRepeatedUserLines } from "@/lib/transcript/dedupe";
import { canMarkCompleted } from "@/lib/session-report-policy";
import { candidateWriteWindow, completionEndReason, QUIT_REQUEST_REASON, type CandidateWriteSession } from "@/lib/session-link";
import { stripToolCallText } from "@/lib/transcript/sanitize";
import { devanagariToRoman } from "@/lib/transcript/transliterate";
import { normalizeCandidateLanguage } from "@/lib/interview-language";

export type VoiceSavePayload = {
  sessionId?: string;
  messages?: Array<{
    /** Client-made uuid; a resent line with the same id is stored only once. */
    id?: string;
    role: string;
    content: string;
    questionId?: string;
    source?: string;
    /** Client speak-time ISO; used for correct transcript order. */
    timestamp?: string;
    /** Monotonic client sequence within the session. */
    seq?: number;
  }>;
  complete?: boolean;
  /** "quit": the candidate ended the interview on purpose (End interview button). */
  reason?: string;
  currentQuestionIndex?: number;
  /** Candidate chose / switched language in a multi-language interview ("en" | "hi"). */
  language?: string;
};

/** Text as stored: no tool-call text, and Hindi in Roman script (Hinglish), never Devanagari. */
export function storedLineText(content: unknown): string {
  return devanagariToRoman(stripToolCallText(typeof content === "string" ? content : "")).trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Row id for a saved line: the client's uuid when valid (makes resends idempotent), else a fresh one. */
export function messageRowId(clientId: unknown, makeId: () => string): string {
  return typeof clientId === "string" && UUID_RE.test(clientId) ? clientId.toLowerCase() : makeId();
}

export type ActivitySegment = { enteredAt: string; leftAt: string | null };

const ACTIVITY_GAP_CAP_MS = 5 * 60 * 1000;
const STALE_SESSION_GRACE_MS = 10 * 60 * 1000;

/**
 * For IN_PROGRESS sessions, caps the effective "now" so that abandoned
 * sessions don't accumulate unbounded duration. If the session's last
 * activity was more than STALE_SESSION_GRACE_MS ago, we treat the session
 * as having ended shortly after that last activity.
 */
export function effectiveNowForSession(
  lastActivityAt: string | null | undefined,
  nowMs: number,
): number {
  if (!lastActivityAt) return nowMs;
  const lastMs = new Date(lastActivityAt).getTime();
  if (Number.isNaN(lastMs)) return nowMs;
  return Math.min(nowMs, lastMs + STALE_SESSION_GRACE_MS);
}

export function computeSegmentDuration(
  segments: ActivitySegment[],
  nowMs: number,
): number {
  let totalMs = 0;
  for (const seg of segments) {
    const start = new Date(seg.enteredAt).getTime();
    const end = seg.leftAt ? new Date(seg.leftAt).getTime() : nowMs;
    if (end > start) totalMs += end - start;
  }
  return Math.round(totalMs / 1000);
}

/**
 * Fallback for pre-migration sessions without activity segments.
 * Sums gaps between consecutive message timestamps, capping each gap
 * at 5 minutes to exclude idle periods.
 */
export function computeMessageBasedDuration(
  sessionStartMs: number,
  messageTimestamps: number[],
  endMs: number,
): number {
  const points = [sessionStartMs, ...messageTimestamps, endMs].sort(
    (a, b) => a - b,
  );
  let totalMs = 0;
  for (let i = 1; i < points.length; i++) {
    totalMs += Math.min(points[i] - points[i - 1], ACTIVITY_GAP_CAP_MS);
  }
  return Math.round(totalMs / 1000);
}

export type CompletionSession = {
  /** Current status; COMPLETED / DISQUALIFIED are never re-completed. */
  status?: string;
  startedAt: string;
  interview: {
    title: string;
    objective: string | null;
    language: string;
    userId: string;
    projectId: string;
    assessmentCriteria: { name: string; description: string }[] | null;
    questions: { text: string; order: number; type?: string }[];
  };
};

export type ProgressSession = {
  interview: {
    questions: { id: string }[];
  };
};

export type VoiceSaveOps = {
  insertMessages: (
    sessionId: string,
    messages: NonNullable<VoiceSavePayload["messages"]>,
  ) => Promise<void>;
  loadSessionForCompletion: (
    sessionId: string,
  ) => Promise<CompletionSession | null>;
  loadFirstMessageTimestamp: (sessionId: string) => Promise<string | null>;
  loadSessionForProgress: (sessionId: string) => Promise<ProgressSession | null>;
  updateSession: (
    sessionId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  generateSummary: (
    sessionId: string,
    interviewTitle: string,
    objective?: string | null,
    language?: string | null,
    questions?: { text: string; order: number; type?: string }[] | null,
    assessmentCriteria?: { name: string; description: string }[] | null,
  ) => Promise<void>;
  log: {
    info: (message: string) => void;
    error: (...args: unknown[]) => void;
  };
  now: () => Date;
  /**
   * Queue the automatic report (idempotent, retried server-side). When set it
   * replaces the direct generateSummary call. `force` regenerates after a
   * session that was marked ABANDONED turns out to have completed.
   */
  scheduleReport?: (sessionId: string, opts: { force: boolean }) => void;
  /** Interviewer already said goodbye: a "quit" request then counts as a normal completion. */
  interviewFinished?: (sessionId: string) => Promise<boolean>;
  /** Optional hook after status → COMPLETED (e.g. WhatsApp team notify). */
  onCompleted?: (sessionId: string) => void;
  /** Newest saved message for the session (used to drop repeated candidate lines). */
  loadLastMessage?: (sessionId: string) => Promise<{ role: string; content: string } | null>;
};

export const MAX_SAVE_MESSAGES = 500;
export const MAX_SAVE_LINE_CHARS = 20_000;
/** Client clocks drift a little; later than this is not a real speak time. */
const MAX_CLOCK_SKEW_MS = 60_000;

export type VoiceSaveSessionGate = CandidateWriteSession & {
  modeUsed?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
};

export type VoiceSaveGateResult =
  | { ok: true; payload: VoiceSavePayload }
  | { ok: false; status: number; body: { ok?: boolean; error?: string; completed?: boolean; status?: string } };

/**
 * Decide what a /api/voice/save call may write, before any write happens:
 *  - live session: everything
 *  - just-ended session (grace): only transcript lines and the completion
 *  - otherwise nothing (COMPLETED / DISQUALIFIED answer like a repeated completion)
 * Lines are restricted to the roles a candidate browser legitimately relays:
 * "user", plus "assistant" only for voice sessions (the relay's interviewer
 * speech); "chat" tags only on the candidate's typed lines; timestamps clamped
 * to the session's lifetime.
 */
export function gateVoiceSave(
  payload: VoiceSavePayload,
  session: VoiceSaveSessionGate,
  opts: { inviteExpiresAt?: string | null; nowMs?: number } = {},
): VoiceSaveGateResult {
  const now = opts.nowMs ?? Date.now();
  const window = candidateWriteWindow(session, { inviteExpiresAt: opts.inviteExpiresAt, nowMs: now });
  if (window === "closed") {
    if (session.status === "COMPLETED" || session.status === "DISQUALIFIED") {
      return { ok: false, status: 200, body: { ok: true, completed: session.status === "COMPLETED", status: session.status } };
    }
    return { ok: false, status: 409, body: { error: "Session has ended", completed: false, status: session.status } };
  }

  const raw = payload.messages;
  if (raw !== undefined && !Array.isArray(raw)) {
    return { ok: false, status: 400, body: { error: "Invalid messages" } };
  }
  if (raw && raw.length > MAX_SAVE_MESSAGES) {
    return { ok: false, status: 413, body: { error: "Too many messages" } };
  }
  const voice = session.modeUsed === "VOICE";
  const startMs = Date.parse(session.startedAt ?? session.createdAt ?? "");
  const messages: NonNullable<VoiceSavePayload["messages"]> = [];
  for (const m of raw ?? []) {
    if (!m || typeof m !== "object" || typeof m.content !== "string") {
      return { ok: false, status: 400, body: { error: "Invalid message" } };
    }
    if (m.role !== "user" && !(m.role === "assistant" && voice)) {
      return { ok: false, status: 400, body: { error: "Invalid message role" } };
    }
    if (m.content.length > MAX_SAVE_LINE_CHARS) {
      return { ok: false, status: 413, body: { error: "Message too long" } };
    }
    const ts = typeof m.timestamp === "string" ? Date.parse(m.timestamp) : NaN;
    const tsOk = Number.isFinite(ts) && ts <= now + MAX_CLOCK_SKEW_MS && !(Number.isFinite(startMs) && ts < startMs);
    messages.push({
      id: typeof m.id === "string" ? m.id : undefined,
      role: m.role,
      content: m.content,
      questionId: typeof m.questionId === "string" ? m.questionId : undefined,
      source: m.role === "user" && m.source === "chat" ? "chat" : undefined,
      timestamp: tsOk ? m.timestamp : undefined,
      seq: typeof m.seq === "number" && Number.isFinite(m.seq) ? m.seq : undefined,
    });
  }

  const sanitized: VoiceSavePayload = {
    sessionId: payload.sessionId,
    ...(raw ? { messages } : {}),
    complete: payload.complete === true,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  };
  if (window === "live") {
    sanitized.language = payload.language;
    if (typeof payload.currentQuestionIndex === "number") sanitized.currentQuestionIndex = payload.currentQuestionIndex;
    return { ok: true, payload: sanitized };
  }
  // Grace: late transcript lines / completion only; a late "complete" may only
  // turn an ABANDONED session COMPLETED (a COMPLETED one stays as it is).
  if (!sanitized.messages?.length && !sanitized.complete) {
    return { ok: false, status: 409, body: { error: "Session has ended", completed: session.status === "COMPLETED", status: session.status } };
  }
  return { ok: true, payload: sanitized };
}

export async function handleVoiceSave(
  payload: VoiceSavePayload,
  ops: VoiceSaveOps,
): Promise<{ status: number; body: { ok?: boolean; error?: string; completed?: boolean; status?: string } }> {
  const { sessionId, messages, complete, currentQuestionIndex } = payload;

  if (!sessionId) {
    return { status: 400, body: { error: "Missing sessionId" } };
  }

  let insertError: unknown = null;
  // Language choice / switch: saved on its own so a failure never blocks the transcript.
  const chosenLanguage = normalizeCandidateLanguage(payload.language);
  if (chosenLanguage) {
    try {
      await ops.updateSession(sessionId, { language: chosenLanguage });
    } catch (err) {
      ops.log.error(`Saving language for ${sessionId} failed:`, err);
    }
    // Language-only call (choice in onboarding / switch): nothing else to do.
    if (!(Array.isArray(messages) && messages.length) && !complete && typeof currentQuestionIndex !== "number") {
      return { status: 200, body: { ok: true } };
    }
  }
  try {
    if (messages && Array.isArray(messages) && messages.length > 0) {
      let lastSaved: { role: string; content: string } | null = null;
      if (ops.loadLastMessage) {
        try {
          lastSaved = await ops.loadLastMessage(sessionId);
        } catch {
          lastSaved = null;
        }
      }
      // Never store tool-call text the voice model spoke ("signal_question_change{…}").
      const clean = messages
        .map((m) => ({ ...m, content: storedLineText(m.content) }))
        .filter((m) => m.content);
      const { kept, dropped } = dropRepeatedUserLines(lastSaved, clean);
      if (dropped > 0) ops.log.info(`Dropped ${dropped} repeated candidate line(s) for session ${sessionId}`);
      if (kept.length > 0) {
        try {
          await ops.insertMessages(sessionId, kept);
        } catch (err) {
          // Without completion, fail now so the client keeps the lines and retries.
          if (!complete) throw err;
          // A tab-close beacon can't retry: still mark the session complete,
          // then answer 500 so a client that is still open resends the lines.
          insertError = err;
          ops.log.error(`Message insert failed for ${sessionId} during completion:`, err);
        }
      }
    }

    if (complete) {
      const session = await ops.loadSessionForCompletion(sessionId);

      if (!session) {
        ops.log.error(`Completion for ${sessionId}: session not found`);
        return { status: 404, body: { error: "Session not found", completed: false } };
      }
      if (session.status && !canMarkCompleted(session.status)) {
        // Repeated completion (end flow + disconnect, beacon) or disqualified:
        // keep the first completion and don't regenerate the report.
        ops.log.info(`Session ${sessionId} already ${session.status}; completion ignored`);
        const completed = session.status === "COMPLETED";
        if (insertError) return { status: 500, body: { error: "Failed to save voice data", completed, status: session.status } };
        return {
          status: 200,
          body: { ok: true, completed, status: session.status },
        };
      } else {
        const wasAbandoned = session.status === "ABANDONED";
        const firstMessageTimestamp =
          await ops.loadFirstMessageTimestamp(sessionId);

        const actualStart = firstMessageTimestamp
          ? new Date(firstMessageTimestamp).getTime()
          : new Date(session.startedAt).getTime();
        const now = ops.now();
        const duration = Math.round((now.getTime() - actualStart) / 1000);

        const endReason = completionEndReason(
          payload.reason,
          payload.reason === QUIT_REQUEST_REASON ? !!(await ops.interviewFinished?.(sessionId)) : false,
        );

        await ops.updateSession(sessionId, {
          status: "COMPLETED" as const,
          completedAt: now.toISOString(),
          startedAt: new Date(actualStart).toISOString(),
          totalDurationSeconds: duration,
          endReason,
        });

        ops.log.info(
          `Session ${sessionId} marked COMPLETED (${duration}s)${wasAbandoned ? " — was ABANDONED (late completion)" : ""}`,
        );

        ops.onCompleted?.(sessionId);

        const interview = session.interview;
        if (ops.scheduleReport) {
          ops.scheduleReport(sessionId, { force: wasAbandoned });
        } else ops
          .generateSummary(
            sessionId,
            interview.title,
            interview.objective,
            interview.language,
            interview.questions,
            interview.assessmentCriteria,
          )
          .catch((err) => {
            ops.log.error("Background summary generation failed:", err);
          });
        if (insertError) return { status: 500, body: { error: "Failed to save voice data", completed: true, status: "COMPLETED" } };
        return { status: 200, body: { ok: true, completed: true, status: "COMPLETED" } };
      }
    } else if (typeof currentQuestionIndex === "number") {
      const session = await ops.loadSessionForProgress(sessionId);

      if (session) {
        const questions = session.interview?.questions ?? [];
        const question = questions[currentQuestionIndex];
        await ops.updateSession(sessionId, {
          ...(question ? { currentQuestionId: question.id } : {}),
          lastActivityAt: ops.now().toISOString(),
        });

        ops.log.info(
          `Progress saved for session ${sessionId} at question ${currentQuestionIndex + 1}`,
        );
      }
    } else {
      await ops.updateSession(sessionId, {
        lastActivityAt: ops.now().toISOString(),
      });

      ops.log.info(`Heartbeat saved for session ${sessionId}`);
    }

    return { status: 200, body: { ok: true } };
  } catch (error) {
    ops.log.error("Voice save error:", error);
    return { status: 500, body: { error: "Failed to save voice data" } };
  }
}
