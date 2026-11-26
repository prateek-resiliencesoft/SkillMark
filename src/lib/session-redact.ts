/**
 * Candidate-facing projections. Allowlists, not denylists: a new interviewer-only
 * column must never reach a public response just because nobody listed it here.
 */

const INTERVIEW_CANDIDATE_FIELDS = [
  "id",
  "title",
  "description",
  "objective",
  "mode",
  "allowModeSwitch",
  "aiName",
  "aiGender",
  "aiTone",
  "followUpDepth",
  "language",
  "timeLimitMinutes",
  "requireInvite",
  "chatEnabled",
  "voiceEnabled",
  "videoEnabled",
  "videoMode",
  "antiCheatingEnabled",
  "headMovementDetectionEnabled",
  "integrityChecksEnabled",
  "livenessChallengesEnabled",
] as const;

const QUESTION_CANDIDATE_FIELDS = [
  "id",
  "order",
  "text",
  "description",
  "type",
  "options",
  "starterCode",
  "showIf",
  "skipIf",
  "timeLimitSeconds",
  "isRequired",
  "allowFileUpload",
  "allowedFileTypes",
] as const;

const SESSION_CANDIDATE_FIELDS = [
  "id",
  "status",
  "language",
  "currentQuestionId",
  "modeUsed",
  "startedAt",
  "interviewBeganAt",
] as const;

const MESSAGE_CANDIDATE_FIELDS = ["id", "role", "content", "contentType", "whiteboardData", "questionId", "timestamp"] as const;

const CANDIDATE_ROW_FIELDS = [
  "id",
  "interviewId",
  "name",
  "email",
  "expiresAt",
  "scheduledAt",
  "sessionId",
  "tailorInterview",
  "skills",
  "tailoredQuestions",
] as const;

type Row = Record<string, unknown>;

function pick<T extends Row, K extends string>(row: T, keys: readonly K[]): Partial<Pick<T, K & keyof T>> {
  const out: Row = {};
  for (const k of keys) if (k in row) out[k] = row[k];
  return out as Partial<Pick<T, K & keyof T>>;
}

type InterviewField = (typeof INTERVIEW_CANDIDATE_FIELDS)[number];
type QuestionField = (typeof QUESTION_CANDIDATE_FIELDS)[number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InterviewView = Partial<Record<InterviewField, any>> & { questions?: Partial<Record<QuestionField, any>>[] };

/** Interview fields a candidate needs to take the interview; never prompts, rubrics, invite lists or team contacts. */
export function projectInterviewForCandidate(
  interview: Row | null | undefined,
  opts: { includeQuestions?: boolean } = {},
): InterviewView | null {
  if (!interview || typeof interview !== "object") return null;
  const out: InterviewView = pick(interview, INTERVIEW_CANDIDATE_FIELDS);
  const questions = Array.isArray(interview.questions) ? (interview.questions as Row[]) : null;
  if (questions) {
    out.questions = opts.includeQuestions === false ? [] : questions.map((q) => pick(q, QUESTION_CANDIDATE_FIELDS));
  }
  return out;
}

/** Minimal linked-session view for an invite link holder. */
export function projectInviteSessionForCandidate<T extends Row>(session: T | null | undefined) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  return pick(session, ["id", "status", "interviewBeganAt", "language"] as const);
}

/** Candidate row fields the invite pages render; never notes, CV profile, delivery state or old tokens. */
export function projectCandidateForInvite<T extends Row>(candidate: T) {
  return pick(candidate, CANDIDATE_ROW_FIELDS);
}

const ACTIVE_STATUS = "IN_PROGRESS";

/**
 * Candidate-safe view of a session. Ended, superseded or archived sessions expose
 * only their status (the end screens need nothing else); a live session also carries
 * its own transcript for resume.
 */
export function redactSessionForCandidate<T extends Record<string, unknown>>(session: T) {
  const base = pick(session, SESSION_CANDIDATE_FIELDS);
  const live = session.status === ACTIVE_STATUS && !session.dataArchivedAt && !session.supersededAt;
  if (!live) return { id: base.id, status: base.status, language: base.language };
  const messages = Array.isArray(session.messages)
    ? (session.messages as Record<string, unknown>[]).map((m) => pick(m, MESSAGE_CANDIDATE_FIELDS))
    : [];
  return {
    ...base,
    messages,
    interview: projectInterviewForCandidate(session.interview as Record<string, unknown> | null),
  };
}
