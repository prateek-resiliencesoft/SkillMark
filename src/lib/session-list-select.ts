/**
 * Session columns for list/dashboard embeds.
 * Omits fat blobs (screenshots, recordings, anti-cheat logs, full summary text)
 * that list UIs never render — detail views fetch those separately.
 *
 * Keep these as string *literals* (not templates) so supabase-js can type-parse them.
 */
export const SESSION_LIST_COLUMNS =
  "id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt" as const;

/** Candidate list embed (interview-scoped). */
export const CANDIDATE_LIST_WITH_SESSION =
  "*, session:sessions!candidates_sessionId_fkey(id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt)" as const;

/** Cross-project candidate list. */
export const CANDIDATE_LIST_ALL_WITH_SESSION =
  "*, session:sessions!candidates_sessionId_fkey(id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt), interview:interviews!inner(id, title)" as const;

/** Walk-in sessions for interview list. */
export const WALKIN_SESSION_LIST =
  "id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt, messages(id)" as const;

/** Walk-ins on the all-candidates page. */
export const WALKIN_SESSION_LIST_ALL =
  "id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt, messages(id), interview:interviews!inner(id, title)" as const;

/** session.listByInterview */
export const SESSION_LIST_WITH_MESSAGE_IDS =
  "id, interviewId, candidateId, participantName, participantEmail, participantPhone, status, modeUsed, insights, themes, startedAt, completedAt, lastActivityAt, lastHeartbeatAt, interviewBeganAt, totalDurationSeconds, endReason, reportStatus, reportAttempts, reportStartedAt, dataArchivedAt, supersededAt, mediaReviewStatus, mediaClearedAt, mediaExpiresAt, createdAt, updatedAt, messages(id)" as const;

/** Even slimmer: admin activity tables that only need status/timing. */
export const SESSION_ACTIVITY_COLUMNS =
  "id, interviewId, candidateId, participantName, participantEmail, status, endReason, reportStatus, summary, insights, lastHeartbeatAt, totalDurationSeconds, createdAt, completedAt" as const;
