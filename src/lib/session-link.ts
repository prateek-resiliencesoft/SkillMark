/**
 * One-time interview links.
 *
 * Once the candidate passes onboarding the interview "begins" and the open tab
 * must keep sending heartbeats. If the tab closes or the connection drops
 * (heartbeat stops), the session is ended as ABANDONED. Before that (pre-flight:
 * info, photo, mic / screen checks) nothing is ever abandoned: the link just
 * keeps working. An explicit Quit completes the session with endReason QUIT.
 * COMPLETED (incl. quit) / DISQUALIFIED links never reopen. ABANDONED links stay usable: opening them again starts a
 * fresh attempt for the same candidate (the abandoned session is kept, marked
 * superseded). The recruiter's expiresAt deadline still applies.
 */

/** Client heartbeat cadence. */
/** Shown on the candidate expired / revoked-link page. */
export const EXPIRED_INVITE_MESSAGE =
  "This link has expired. Please ask the recruiter for a new link.";

export const HEARTBEAT_INTERVAL_MS = 5_000;
/** No heartbeat for this long → the candidate is gone (≈3 missed beats). */
export const HEARTBEAT_GRACE_MS = 20_000;

export type EndReason = "TAB_CLOSED" | "DISCONNECTED";

/** endReason of a COMPLETED session the candidate quit on purpose (End interview button). */
export const QUIT_END_REASON = "QUIT";
export const QUIT_EARLY_LABEL = "Quit early";

/** Value of `reason` that the client sends to the end endpoints for an explicit quit. */
export const QUIT_REQUEST_REASON = "quit";

/** Reviewer tag: candidate ended the interview early on purpose. */
export function isQuitEarly(s: { status?: string | null; endReason?: string | null } | null | undefined): boolean {
  return s?.status === "COMPLETED" && s.endReason === QUIT_END_REASON;
}

/**
 * endReason to store when completing. A quit counts only if the interviewer had
 * not already finished (said goodbye): then it was a normal completion.
 */
export function completionEndReason(requested: unknown, interviewFinished: boolean): "COMPLETED" | "QUIT" {
  return requested === QUIT_REQUEST_REASON && !interviewFinished ? QUIT_END_REASON : "COMPLETED";
}

/** The live interview started (past pre-flight). Only then can a session be abandoned. */
export function isInterviewBegun(s: { interviewBeganAt?: string | null } | null | undefined): boolean {
  return !!s?.interviewBeganAt;
}

/**
 * Whether leave / heartbeat loss / sweep may mark this session ABANDONED: only a
 * live interview that has begun. Pre-flight (setup screens) stays pending.
 */
export function canAbandon(s: { status?: string | null; interviewBeganAt?: string | null } | null | undefined): boolean {
  return s?.status === "IN_PROGRESS" && isInterviewBegun(s);
}

export type LinkSessionState = {
  status: string;
  interviewBeganAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastActivityAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
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

/** An abandoned attempt doesn't burn the invite: the link starts a fresh attempt. */
export function canRestartFromLink(status: string | null | undefined): boolean {
  return status === "ABANDONED";
}

/** What opening an invite link does with the candidate's linked session. */
export function inviteSessionAction(status: string | null | undefined): "create" | "restart" | "reuse" {
  if (!status) return "create";
  return canRestartFromLink(status) ? "restart" : "reuse";
}

/** Same-tab start retries may re-confirm a begun interview for this long. */
export const START_RETRY_WINDOW_MS = 10 * 60_000;

export type StartDecision =
  | { action: "start" }
  | { action: "resume" }
  | { action: "abandon_stale" }
  | { action: "expired"; status: string };

/**
 * POST /api/session/start. Idempotent for the tab that started it: a retry
 * (lost response, transient error, Retry button) re-confirms the same session
 * while its heartbeat is fresh. A fresh tab on a begun interview is still
 * refused, so the link stays one-time for everyone else.
 */
export function decideStart(
  s: LinkSessionState,
  opts: { retry?: boolean; nowMs?: number } = {},
): StartDecision {
  const now = opts.nowMs ?? Date.now();
  if (s.status !== "IN_PROGRESS") return { action: "expired", status: s.status };
  if (!s.interviewBeganAt) return { action: "start" };
  if (isHeartbeatStale(s, now)) return { action: "abandon_stale" };
  if (opts.retry && now - new Date(s.interviewBeganAt).getTime() <= START_RETRY_WINDOW_MS) {
    return { action: "resume" };
  }
  return { action: "expired", status: s.status };
}

export type StartResult =
  | { ok: true }
  | { ok: false; expired: true; status?: string }
  | { ok: false; expired?: false; error: string };

/** Error text from a JSON body; rate-limit bodies nest it as `{ error: { message } }`. */
function errorText(body: unknown, fallback: string): string {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === "string" && e) return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : fallback;
}

const START_FAILED = "Could not start this interview. Check your connection and try again.";

/**
 * Client side of the start call: retries network errors, 5xx and 429 with
 * backoff. Every call after the first is flagged `retry` so the server can
 * recognise a start that already landed.
 */
export async function startSessionWithRetry(
  sessionId: string,
  opts: {
    fetchFn?: typeof fetch;
    delaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
    /** The caller already sent a start for this session (Retry button). */
    retry?: boolean;
  } = {},
): Promise<StartResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const delays = opts.delaysMs ?? [1_000, 2_000, 4_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let error = START_FAILED;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let wait = delays[attempt];
    try {
      const res = await fetchFn("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, retry: !!opts.retry || attempt > 0 }),
      });
      const body = (await res.json().catch(() => ({}))) as { expired?: boolean; status?: string };
      if (body.expired) return { ok: false, expired: true, status: body.status };
      if (res.ok) return { ok: true };
      error = errorText(body, START_FAILED);
      if (res.status !== 429 && res.status < 500) return { ok: false, error };
      const retryAfter = Number(res.headers.get("Retry-After"));
      if (res.status === 429 && retryAfter > 0) wait = Math.min(retryAfter * 1_000, 10_000);
    } catch {
      error = START_FAILED;
    }
    if (wait === undefined) break;
    await sleep(wait);
  }
  return { ok: false, error };
}

/**
 * The invite link's deadline (candidates.expiresAt) has passed and the candidate never finished.
 * A COMPLETED / DISQUALIFIED session is done, so its link is not "expired" in any useful sense.
 */
export function isLinkExpired(opts: {
  session?: { status?: string | null } | null;
  expiresAt?: string | null;
  nowMs?: number;
}): boolean {
  const status = opts.session?.status ?? null;
  if (status === "COMPLETED" || status === "DISQUALIFIED") return false;
  if (!opts.expiresAt) return false;
  const t = new Date(opts.expiresAt).getTime();
  return Number.isFinite(t) && t < (opts.nowMs ?? Date.now());
}

/** True when the recruiter should issue a new token (not merely resend the current one). */
export function needsFreshInviteLink(opts: {
  session?: LinkSessionState | null;
  expiresAt?: string | null;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const status = opts.session?.status ?? null;
  if (status === "COMPLETED" || status === "DISQUALIFIED") return false;
  if (status === "ABANDONED") return true;
  if (opts.session && isHeartbeatStale(opts.session, now)) return true;
  if (opts.expiresAt && new Date(opts.expiresAt).getTime() < now) return true;
  return false;
}
