/** Candidate-safe view of a session: strips interviewer-only data. */
export function redactSessionForCandidate<T extends Record<string, unknown>>(session: T) {
  const interview = session.interview as Record<string, unknown> | null;
  const safeInterview = interview
    ? {
        ...interview,
        systemPrompt: undefined,
        prompt: undefined,
        invitedEmails: undefined,
        assessmentCriteria: undefined,
        scoringRubric: undefined,
      }
    : null;
  return {
    ...session,
    summary: undefined,
    insights: undefined,
    themes: undefined,
    sentiment: undefined,
    antiCheatingLog: undefined,
    activitySegments: undefined,
    interview: safeInterview,
  };
}
