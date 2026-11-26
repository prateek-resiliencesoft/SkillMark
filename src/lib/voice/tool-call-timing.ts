/**
 * When to decide on the model's signal_question_change (pure, unit-tested).
 *
 * With browser VAD the model can call the tool as soon as the candidate's turn
 * ends, before Gemini has sent that turn's input transcription. Deciding then
 * saw "no answer yet" and rejected a complete answer (Hindi interview 2,
 * 03:36:20 → rejected at 03:36:22 → the follow-up was asked again). The relay
 * now waits briefly for the transcript before deciding.
 */

/** Longest the relay holds a tool call waiting for the candidate's transcript. */
export const TOOL_DECISION_MAX_WAIT_MS = 2_500;
/** Quiet time after the last transcript chunk before the answer is treated as final. */
export const TOOL_DECISION_QUIET_MS = 600;
/** Re-check interval while waiting. */
export const TOOL_DECISION_POLL_MS = 150;

export type ToolTimingState = {
  /** ms the call has been held so far. */
  waitedMs: number;
  /** The candidate's browser turn is still open (they are still talking). */
  candidateTurnOpen: boolean;
  /** Candidate speech (VAD speech-end / voiced audio) happened since the interviewer's last turn. */
  speechSinceModel: boolean;
  /** Transcript words for that speech have arrived. */
  transcriptSinceModel: boolean;
  /** ms since the last transcript chunk, or null if none. */
  msSinceTranscriptChunk: number | null;
};

/** 0 = decide now; otherwise wait this many ms and check again. */
export function toolDecisionDelayMs(s: ToolTimingState): number {
  const left = TOOL_DECISION_MAX_WAIT_MS - s.waitedMs;
  if (left <= 0) return 0;
  if (s.candidateTurnOpen) return Math.min(TOOL_DECISION_POLL_MS, left);
  if (s.speechSinceModel && !s.transcriptSinceModel) return Math.min(TOOL_DECISION_POLL_MS, left);
  if (s.msSinceTranscriptChunk !== null && s.msSinceTranscriptChunk < TOOL_DECISION_QUIET_MS) {
    return Math.min(TOOL_DECISION_QUIET_MS - s.msSinceTranscriptChunk, left);
  }
  return 0;
}

/** Grace after the candidate stops talking during which no "are you there?" reminder may fire. */
export const SILENCE_PROMPT_AFTER_ANSWER_MS = 10_000;

export type SilencePromptState = {
  candidateTurnOpen: boolean;
  aiAudioPlaying: boolean;
  modelGenerating: boolean;
  toolDecisionPending: boolean;
  replyWatchdogArmed: boolean;
  candidateWordsSinceModel: boolean;
  msSinceCandidateSpeech: number | null;
  interviewEnding: boolean;
};

/** A silence reminder must not fire while anyone is talking, the model is working, or right after an answer. */
export function silencePromptBlocked(s: SilencePromptState): boolean {
  return s.candidateTurnOpen || s.aiAudioPlaying || s.modelGenerating || s.toolDecisionPending
    || s.replyWatchdogArmed || s.candidateWordsSinceModel || s.interviewEnding
    || (s.msSinceCandidateSpeech !== null && s.msSinceCandidateSpeech < SILENCE_PROMPT_AFTER_ANSWER_MS);
}
