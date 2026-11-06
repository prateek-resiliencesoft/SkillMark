import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActivitySegment } from "@/app/api/voice/save/logic";
import { isHeartbeatStale, type EndReason } from "@/lib/session-link";

/**
 * End an in-progress session as ABANDONED (link becomes unusable).
 * Only touches IN_PROGRESS rows so it can never undo a completion.
 */
export async function abandonSession(sessionId: string, reason: EndReason): Promise<boolean> {
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

  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ status: "ABANDONED", endReason: reason, activitySegments: segments })
    .eq("id", sessionId)
    .eq("status", "IN_PROGRESS");
  return !error;
}

/**
 * Lazy expiry: if the heartbeat is stale, abandon now and return the updated
 * status. Safe to call on every read of a session.
 */
export async function expireIfStale<
  T extends { id: string; status: string; interviewBeganAt?: string | null; lastHeartbeatAt?: string | null },
>(session: T): Promise<T> {
  if (!isHeartbeatStale(session)) return session;
  await abandonSession(session.id, "DISCONNECTED");
  return { ...session, status: "ABANDONED" };
}
