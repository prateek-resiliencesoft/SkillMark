import { isLinkExpired } from "@/lib/session-link";

/**
 * Dashboard state of the "you left your interview" WhatsApp follow-up for one candidate.
 * "Sent" mirrors the server dedupe: followupSentToken equals the current inviteToken, so a
 * re-issued link counts as not yet sent. Only abandoned sessions with a live link are
 * eligible: when the link has expired the recruiter extends it first.
 */
export interface FollowupCandidate {
  expiresAt?: string | null;
  inviteToken?: string | null;
  followupSentAt?: string | null;
  followupSentToken?: string | null;
  followupError?: string | null;
}

export interface FollowupSession {
  status?: string | null;
}

export interface LeftFollowupState {
  /** Worth showing a follow-up status: the candidate left midway, or one was sent for this link. */
  relevant: boolean;
  /** The candidate left midway and the link is still valid, so the follow-up can be sent. */
  applicable: boolean;
  /** The link has expired: extend the expiry before sending anything. */
  expired: boolean;
  sent: boolean;
  sentAt: string | null;
  /** Why the last attempt did not go out (only when not sent). */
  error: string | null;
}

export function leftFollowupState(
  candidate: FollowupCandidate | null | undefined,
  session: FollowupSession | null | undefined,
): LeftFollowupState {
  const sent = !!candidate?.inviteToken && !!candidate.followupSentAt && candidate.followupSentToken === candidate.inviteToken;
  const expired = isLinkExpired({ session, expiresAt: candidate?.expiresAt });
  const left = session?.status === "ABANDONED";
  return {
    relevant: sent || left,
    applicable: left && !!candidate?.inviteToken && !expired,
    expired,
    sent,
    sentAt: sent ? (candidate?.followupSentAt ?? null) : null,
    error: sent ? null : (candidate?.followupError?.trim() || null),
  };
}

/** True when the candidate left, and the follow-up has not gone out: show "Send follow-up". */
export function needsLeftFollowup(
  candidate: FollowupCandidate | null | undefined,
  session: FollowupSession | null | undefined,
): boolean {
  const s = leftFollowupState(candidate, session);
  return s.applicable && !s.sent;
}
