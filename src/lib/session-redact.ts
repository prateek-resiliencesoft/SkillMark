/** Interviewer-only session fields, beyond the explicit list below: any `integrity*` key. */
const INTEGRITY_KEY = /^integrity/i;

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
  const integrityKeys = Object.fromEntries(
    Object.keys(session).filter((k) => INTEGRITY_KEY.test(k)).map((k) => [k, undefined]),
  );
  return {
    ...session,
    ...integrityKeys,
    summary: undefined,
    insights: undefined,
    themes: undefined,
    sentiment: undefined,
    antiCheatingLog: undefined,
    integritySignals: undefined,
    activitySegments: undefined,
    interview: safeInterview,
  };
}
