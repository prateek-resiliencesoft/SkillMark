/**
 * Detects interviews where the interviewer's lines were saved but the
 * candidate's answers were not (e.g. the mic audio never reached the voice AI).
 * Scoring such a transcript would grade the candidate as silent, so callers
 * store a capture-failure flag instead of a score.
 */
export type CaptureFailure = {
  reason: "no_candidate_transcript";
  recordingAvailable: boolean;
  assistantLines: number;
  candidateWords: number;
  detectedAt: string;
};

/** Below this many candidate words across the whole session we treat it as not captured. */
export const MIN_CANDIDATE_WORDS = 8;
/** Need at least this many interviewer lines before calling it a capture failure. */
export const MIN_ASSISTANT_LINES = 3;

type Msg = { role: string; content: string | null | undefined };

function words(text: string | null | undefined): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

export function assessCandidateCapture(messages: Msg[]): {
  failed: boolean;
  assistantLines: number;
  candidateWords: number;
} {
  let assistantLines = 0;
  let candidateWords = 0;
  for (const m of messages) {
    const role = String(m.role).toLowerCase();
    if (role === "user") candidateWords += words(m.content);
    else if (role === "assistant") assistantLines += 1;
  }
  return {
    failed: assistantLines >= MIN_ASSISTANT_LINES && candidateWords < MIN_CANDIDATE_WORDS,
    assistantLines,
    candidateWords,
  };
}

export function buildCaptureFailure(
  check: { assistantLines: number; candidateWords: number },
  recordingAvailable: boolean,
): CaptureFailure {
  return {
    reason: "no_candidate_transcript",
    recordingAvailable,
    assistantLines: check.assistantLines,
    candidateWords: check.candidateWords,
    detectedAt: new Date().toISOString(),
  };
}
