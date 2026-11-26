/**
 * Transcript clean-up shared by the voice relay, the browser hook and the
 * save API (pure, unit-tested):
 *  - remove function-call text the voice model sometimes speaks or
 *    transcribes ("signal_question_change{questionIndex:10,userRequested:false")
 *  - end a cut-off AI turn cleanly instead of gluing it to the next one
 *  - spot an AI line that repeats the AI line right before it
 */
import { compareUserLines } from "@/lib/transcript/dedupe";

/** Tools the interviewer model can call; their names must never reach the transcript. */
export const TOOL_NAMES = ["signal_question_change"] as const;

const ARG_PAIRS = String.raw`(?:\s*["']?\w+["']?\s*[:=]\s*["']?[\w.\-]*["']?\s*,?)*`;
const TOOL_CALL_RE = new RegExp(
  String.raw`(?:\bprint\(\s*)?(?:\bdefault_api\.)?\b(?:${TOOL_NAMES.join("|")})\b\s*(?:\(${ARG_PAIRS}\s*\)?|\{${ARG_PAIRS}\s*\}?)?\)?`,
  "gi",
);
const TOOL_FENCE_RE = /```(?:tool_code|tool_outputs?)[\s\S]*?(?:```|$)/gi;

/**
 * Internal relay cues that must never show up as a chat turn: the code /
 * whiteboard context updates sent to the model and the silence / no-answer
 * cues. The marker, its line, an optional code fence and the "(This is the
 * participant's code ...)" note are removed.
 */
const INTERNAL_CUE_RE =
  /\[(?:CODE_UPDATE|WHITEBOARD_UPDATE|SILENCE_PROMPT|NO_ANSWER)\][^\n`]*\s*(?:```[\s\S]*?(?:```|$))?(?:\s*\((?:This is|Do not respond|The participant)[^)]*\))?/gi;

/** Remove relay-internal cue messages (e.g. `[CODE_UPDATE] …`) from a transcript line. */
export function stripInternalCueText(text: string): string {
  if (!text) return "";
  return text
    .replace(INTERNAL_CUE_RE, " ")
    // A relay instruction read aloud: "[SYSTEM] …" / "[ANSWER_CHECK_IN] …" to the end of the line.
    .replace(/\[\s*(?:SYSTEM|ANSWER_CHECK_IN)\s*\][\s\S]*$/i, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Remove spoken / transcribed tool-call text. Returns "" when nothing real is left. */
export function stripToolCallText(text: string): string {
  if (!text) return "";
  const cleaned = stripInternalCueText(text)
    .replace(TOOL_FENCE_RE, " ")
    .replace(TOOL_CALL_RE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:。！？，])/g, "$1")
    .trim();
  // Only punctuation left (e.g. "}" or ",") → nothing to keep.
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

/** A turn that was cut off: keep it as its own line, ended with "…". */
export function closePartialTurn(text: string): string {
  const t = stripToolCallText(text).trim();
  if (!t) return "";
  return /[.!?。！？…]$/.test(t) ? t : `${t}…`;
}

/**
 * The AI said (nearly) the same thing as its previous line with no candidate
 * line in between, e.g. the same question asked twice back to back.
 */
export function isRepeatedAssistantLine(prev: string | null | undefined, next: string): boolean {
  if (!prev) return false;
  const kind = compareUserLines(prev, next);
  return kind === "same" || kind === "contained" || kind === "similar";
}
