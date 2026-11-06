/**
 * One-time interview links.
 *
 * A link is single-use: once the candidate passes onboarding the interview
 * "begins" and the open tab must keep sending heartbeats. If the tab closes or
 * the connection drops (heartbeat stops), the session is ended as ABANDONED and
 * the link is dead. COMPLETED / ABANDONED / DISQUALIFIED sessions never reopen.
 */

/** Client heartbeat cadence. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** No heartbeat for this long → the candidate is gone (≈3 missed beats). */
export const HEARTBEAT_GRACE_MS = 20_000;

export type EndReason = "TAB_CLOSED" | "DISCONNECTED";

export type LinkSessionState = {
  status: string;
  interviewBeganAt?: string | null;
  lastHeartbeatAt?: string | null;
};

/** True when the interview began, is still open, and heartbeats stopped. */
export function isHeartbeatStale(
  s: LinkSessionState,
  nowMs: number = Date.now(),
  graceMs: number = HEARTBEAT_GRACE_MS,
): boolean {
  if (s.status !== "IN_PROGRESS" || !s.interviewBeganAt) return false;
  const last = s.lastHeartbeatAt ?? s.interviewBeganAt;
  return nowMs - new Date(last).getTime() > graceMs;
}

/** The session can no longer be (re)entered through its invite link. */
export function isLinkConsumed(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "ABANDONED" || status === "DISQUALIFIED";
}
