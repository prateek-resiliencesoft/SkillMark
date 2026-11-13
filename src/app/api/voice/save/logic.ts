import { dropRepeatedUserLines } from "@/lib/transcript/dedupe";
import { canMarkCompleted } from "@/lib/session-report-policy";

export type VoiceSavePayload = {
  sessionId?: string;
  messages?: Array<{
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
  currentQuestionIndex?: number;
};

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
  /** Optional hook after status → COMPLETED (e.g. WhatsApp team notify). */
  onCompleted?: (sessionId: string) => void;
  /** Newest saved message for the session (used to drop repeated candidate lines). */
  loadLastMessage?: (sessionId: string) => Promise<{ role: string; content: string } | null>;
};

export async function handleVoiceSave(
  payload: VoiceSavePayload,
  ops: VoiceSaveOps,
): Promise<{ status: number; body: { ok?: boolean; error?: string } }> {
  const { sessionId, messages, complete, currentQuestionIndex } = payload;

  if (!sessionId) {
    return { status: 400, body: { error: "Missing sessionId" } };
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
      const { kept, dropped } = dropRepeatedUserLines(lastSaved, messages);
      if (dropped > 0) ops.log.info(`Dropped ${dropped} repeated candidate line(s) for session ${sessionId}`);
      if (kept.length > 0) await ops.insertMessages(sessionId, kept);
    }

    if (complete) {
      const session = await ops.loadSessionForCompletion(sessionId);

      if (session && session.status && !canMarkCompleted(session.status)) {
        // Repeated completion (end flow + disconnect, beacon) or disqualified:
        // keep the first completion and don't regenerate the report.
        ops.log.info(`Session ${sessionId} already ${session.status}; completion ignored`);
      } else if (session) {
        const wasAbandoned = session.status === "ABANDONED";
        const firstMessageTimestamp =
          await ops.loadFirstMessageTimestamp(sessionId);

        const actualStart = firstMessageTimestamp
          ? new Date(firstMessageTimestamp).getTime()
          : new Date(session.startedAt).getTime();
        const now = ops.now();
        const duration = Math.round((now.getTime() - actualStart) / 1000);

        await ops.updateSession(sessionId, {
          status: "COMPLETED" as const,
          completedAt: now.toISOString(),
          startedAt: new Date(actualStart).toISOString(),
          totalDurationSeconds: duration,
          endReason: "COMPLETED",
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
