import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActivitySegment } from "@/app/api/voice/save/logic";
import { isPreflightStale } from "@/lib/preflight";
import { isHeartbeatStale, type EndReason } from "@/lib/session-link";
import { REPORT_DELAY_AFTER_ABANDON_MS, REPORT_DELAY_AFTER_COMPLETE_MS } from "@/lib/session-report-policy";
import { reachedClosing } from "@/lib/session-activity";

/**
 * End an in-progress session (link becomes unusable). ABANDONED normally; if
 * the interviewer had already said goodbye (only the completion call was
 * lost), it's recorded as COMPLETED. Only touches IN_PROGRESS rows so it can
 * never undo a completion. Returns the new status, or false.
 */
export async function abandonSession(
  sessionId: string,
  reason: EndReason,
): Promise<false | "ABANDONED" | "COMPLETED"> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, status, activitySegments, lastHeartbeatAt")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.status !== "IN_PROGRESS") return false;

  // Close open activity at the last moment we knew the candidate was there.
  const leftAt = (session.lastHeartbeatAt as string | null) ?? new Date().toISOString();
  const segments = ((session.activitySegments ?? []) as ActivitySegment[]).map((s) =>
    s.leftAt === null ? { ...s, leftAt } : s,
  );

  let finished = false;
  try {
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("role, content, timestamp")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: false })
      .limit(6);
    finished = reachedClosing(((msgs ?? []) as { role: string; content: string }[]).reverse());
  } catch {
    finished = false;
  }

  const { data: updated, error } = await supabaseAdmin
    .from("sessions")
    .update(
      finished
        ? { status: "COMPLETED", completedAt: leftAt, endReason: "COMPLETED", activitySegments: segments }
        : { status: "ABANDONED", endReason: reason, activitySegments: segments },
    )
    .eq("id", sessionId)
    .eq("status", "IN_PROGRESS")
    .select("id");
  const ended = !error && Array.isArray(updated) && updated.length > 0;
  if (ended && finished) {
    void import("@/lib/session-report-server")
      .then(({ scheduleSessionReport }) =>
        scheduleSessionReport(sessionId, "completed:closing-reached", REPORT_DELAY_AFTER_COMPLETE_MS),
      )
      .catch(() => undefined);
    return "COMPLETED";
  }
  if (ended) {
    // Left early: still build a report from whatever was answered (skipped when
    // there are no answers). Delayed so a late completion / last batch lands first.
    void import("@/lib/session-report-server")
      .then(({ scheduleSessionReport }) =>
        scheduleSessionReport(sessionId, `abandoned:${reason}`, REPORT_DELAY_AFTER_ABANDON_MS),
      )
      .catch(() => undefined);
  }
  return ended ? "ABANDONED" : false;
}

/**
 * Lazy expiry: if the heartbeat is stale, abandon now and return the updated
 * status. Safe to call on every read of a session.
 */
export async function expireIfStale<
  T extends {
    id: string;
    status: string;
    interviewBeganAt?: string | null;
    lastHeartbeatAt?: string | null;
    lastActivityAt?: string | null;
    startedAt?: string | null;
    createdAt?: string | null;
  },
>(session: T): Promise<T> {
  if (isHeartbeatStale(session) || isPreflightStale(session)) {
    const ended = await abandonSession(session.id, "DISCONNECTED");
    return { ...session, status: ended || "ABANDONED" };
  }
  return session;
}

export async function expireSessionsIfStale<T extends Parameters<typeof expireIfStale>[0]>(
  sessions: T[],
): Promise<T[]> {
  return Promise.all(sessions.map((s) => expireIfStale(s)));
}

/** True when this token was rotated off a candidate by "Send new link". */
export async function isRevokedInviteToken(token: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .contains("revokedInviteTokens", [token])
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function expireNestedSession<
  T extends { session?: Parameters<typeof expireIfStale>[0] | null },
>(row: T): Promise<T> {
  const session = row.session;
  if (!session || typeof session !== "object" || Array.isArray(session) || !("id" in session)) {
    return row;
  }
  return { ...row, session: await expireIfStale(session) };
}
