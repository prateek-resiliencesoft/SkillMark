/**
 * Dashboard state of the "you left your interview" WhatsApp follow-up for one candidate.
 * "Sent" mirrors the server dedupe: followupSentToken equals the current inviteToken, so a
 * re-issued link counts as not yet sent. Only abandoned sessions are eligible.
 */
export interface FollowupCandidate {
  inviteToken?: string | null;
  followupSentAt?: string | null;
  followupSentToken?: string | null;
  followupError?: string | null;
}

export interface FollowupSession {
  status?: string | null;
}

export interface LeftFollowupState {
  /** The candidate left midway, so the follow-up is relevant. */
  applicable: boolean;
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
  return {
    applicable: session?.status === "ABANDONED" && !!candidate?.inviteToken,
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
