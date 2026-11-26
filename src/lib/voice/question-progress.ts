/**
 * Server-side question progress for the voice interview (pure, unit-tested).
 * The relay owns the current question; the model can only ask to move, and
 * this guard decides. It never lets the model go backwards or re-open a
 * finished question unless the candidate asked for it.
 */

export type MoveState = {
  current: number;
  total: number;
  /** Questions already asked and left (never asked again by the model). */
  completed: ReadonlySet<number>;
  /** Candidate gave words on the current question. */
  userSpokeThisQuestion: boolean;
  /** Time on the current question. */
  dwellMs: number;
  minDwellMs: number;
  /**
   * The interviewer's newest line asks something the candidate has not
   * answered yet (a follow-up, a stacked question…). Moving on now would skip it.
   */
  openInterviewerQuestion?: boolean;
};

export type MoveRequest = {
  target: number;
  /** Model says the candidate asked to skip / go back. */
  userRequested: boolean;
  /** The candidate's latest words really ask to go back (checked by us, not the model). */
  candidateAskedBack: boolean;
};

export type MoveDecision =
  | { ok: true; target: number; end: boolean }
  | { ok: false; reason: "same" | "invalid" | "backward" | "premature" | "pending_question"; message: string };

/** First question at or after `from` that hasn't been finished (total = interview end). */
export function nextOpenQuestion(from: number, total: number, completed: ReadonlySet<number>): number {
  let i = Math.max(0, from);
  while (i < total && completed.has(i)) i += 1;
  return i;
}

export function decideQuestionMove(state: MoveState, req: MoveRequest): MoveDecision {
  const { current, total } = state;
  const stay = `Stay on question ${current + 1}`;
  if (!Number.isInteger(req.target) || req.target < 0) {
    return { ok: false, reason: "invalid", message: `Invalid question index. ${stay} and continue.` };
  }
  if (req.target === current) {
    return { ok: false, reason: "same", message: `You are already on question ${current + 1}. Continue naturally; do not ask earlier questions again.` };
  }
  if (req.target < current) {
    if (req.userRequested && req.candidateAskedBack) return { ok: true, target: req.target, end: false };
    return {
      ok: false,
      reason: "backward",
      message: `Rejected: question ${req.target + 1} was already asked. Never repeat earlier questions. ${stay} and reply to the participant out loud now.`,
    };
  }
  // Forward: never jump over a question. Whatever the model asks for, the next
  // one is the first question after this one that has not been asked yet.
  const target = nextOpenQuestion(current + 1, total, state.completed);
  // Wrapping up after the last question only needs an answer, not the dwell time.
  const lastAnswered = target >= total && current === total - 1 && state.userSpokeThisQuestion;
  const early = !lastAnswered && (!state.userSpokeThisQuestion || state.dwellMs < state.minDwellMs);
  if (!req.userRequested && state.openInterviewerQuestion) {
    return {
      ok: false,
      reason: "pending_question",
      message: `Rejected: you just asked the participant something and they have not answered yet. ${stay}. Do not speak again and do not move on: wait silently for their answer.`,
    };
  }
  if (!req.userRequested && early) {
    return {
      ok: false,
      reason: "premature",
      message: `Rejected: the participant has not given a substantive answer yet. ${stay}. Do NOT say you are moving on and do NOT ask a new question: wait for the participant's answer (if you must speak, invite them to answer THIS question only, in one short sentence).`,
    };
  }
  return { ok: true, target, end: target >= total };
}

const BACK_RE = [
  /\b(go|going|come)\s+back\s+to\s+(the\s+)?(previous|last|earlier|that|question|q\b)/i,
  /\b(can|could)\s+(we|i)\s+go\s+back\b/i,
  /\bprevious\s+question\b/i,
  /\b(last|earlier|previous)\s+one\b/i,
  /\bback\s+to\s+(the\s+)?(question|q)\s*\d*/i,
  /(上一题|上一个问题|回到上)/,
];

/** The candidate's own words ask to return to an earlier question. */
export function candidateAskedToGoBack(text: string | null | undefined): boolean {
  return !!text && BACK_RE.some((re) => re.test(text));
}

/**
 * The candidate says they were skipped / have not answered: which question to
 * go back to: the current one if it has no real answer yet (or, for "you
 * skipped", the newest earlier one without an answer), else null.
 */
export function findReopenIndex(
  current: number,
  isAnswered: (index: number) => boolean,
  /** "You skipped…": prefer an earlier question over the one now open. */
  preferEarlier = false,
): number | null {
  const cur = Math.max(0, current);
  if (preferEarlier || isAnswered(cur)) {
    for (let i = cur - 1; i >= 0; i--) if (!isAnswered(i)) return i;
  }
  return isAnswered(cur) ? null : cur;
}

/** After a re-asked question was answered: the next question not asked yet, in order. */
export function nextUnaskedAfter(index: number, total: number, completed: ReadonlySet<number>): number {
  return nextOpenQuestion(index + 1, total, completed);
}
