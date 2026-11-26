/**
 * Interviewer (AI) transcript hygiene (pure, unit-tested).
 *
 * The model sometimes reads relay cues or tool-rejection text aloud
 * ("[SYSTEM] The tool call was rejected because ..."), and Gemini's output
 * transcription can re-send the tail of the previous turn at the end of the
 * next one. Neither may ever be shown or saved as an interviewer line.
 */
import { devanagariToRoman } from "@/lib/transcript/transliterate";

/** A bracketed relay tag: [SYSTEM], [SILENCE_PROMPT], [ANSWER_CHECK_IN], [CODE_UPDATE] ... */
const TAG_RE = /\[\s*(SYSTEM|SILENCE_PROMPT|ANSWER_CHECK_IN|CODE_UPDATE|NO_ANSWER|CHECK_IN|RESUME|CUE|[A-Z][A-Z_]{3,})\s*\]/;

/** Sentences that only ever come from relay instructions or tool results. */
const INTERNAL_PHRASES: RegExp[] = [
  /\btool\s+call\b/i,
  /\bsignal_question_change\b/i,
  /\bfunction\s+call\b/i,
  /\bwas\s+rejected\b/i,
  /\bwait\s+silently\b/i,
  /\bremember\s+to\s+follow\s+all\s+(the\s+)?instructions\b/i,
  /\blocked[-\s]answer\s+list\b/i,
  /\bthe\s+participant\s+has\s+not\s+(said|answered)\b/i,
  /\bdo\s+not\s+(repeat\s+yourself|speak\s+again|call\s+any\s+function)\b/i,
  /\byou\s+must\s+wait\s+for\s+the\s+user'?s\s+response\b/i,
];

/** True when a piece of interviewer text is relay / tool text, not speech meant for the candidate. */
export function isInternalText(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return TAG_RE.test(t) || INTERNAL_PHRASES.some((re) => re.test(t));
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [text];
}

/**
 * Remove relay / tool text from an interviewer line. Everything from a
 * bracketed tag to the end of the line is internal (the model reads the whole
 * cue once it starts); single sentences with internal phrases are removed.
 */
export function sanitizeInterviewerText(text: string | null | undefined): string {
  let t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const tag = TAG_RE.exec(t);
  if (tag) t = t.slice(0, tag.index);
  return splitSentences(t)
    .filter((s) => !INTERNAL_PHRASES.some((re) => re.test(s)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose phonetic key so "kuchh/kuch", "chaahte/chahte", Devanagari/Roman compare equal. */
function phoneticTokens(text: string): string[] {
  return devanagariToRoman(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, "$1").replace(/([bcdfgjklmnpqrstvwxz])h/g, "$1"));
}

/** Min words before a sentence can be called a repeat of the previous turn. */
export const STALE_REPEAT_MIN_WORDS = 4;
/** Share of a sentence's words that must appear in an earlier interviewer line. */
export const STALE_REPEAT_RATIO = 0.8;

/**
 * A sentence that is a re-sent copy of an earlier interviewer line (late
 * output transcription glued to the next turn).
 */
export function isStaleRepeatSentence(sentence: string, previousLines: string | readonly string[] | null | undefined): boolean {
  const lines = (typeof previousLines === "string" ? [previousLines] : previousLines ?? []).filter(Boolean);
  if (!lines.length) return false;
  const s = phoneticTokens(sentence);
  if (s.length < STALE_REPEAT_MIN_WORDS) return false;
  return lines.some((line) => {
    const pool = new Set(phoneticTokens(line));
    if (!pool.size) return false;
    return s.filter((w) => pool.has(w)).length / s.length >= STALE_REPEAT_RATIO;
  });
}

/**
 * Clean one finished interviewer turn: strip relay text, then drop TRAILING
 * sentences that repeat an earlier interviewer line (Hindi interview 2,
 * 03:42:59: the farewell ended with "…issue nahi hai, yeh acchi baat hai. Last
 * question, …"). The first sentence is always kept, and only the tail is cut,
 * so a genuine turn is never emptied or reordered.
 */
export function cleanInterviewerTurn(text: string | null | undefined, previousLines?: string | readonly string[] | null): string {
  const clean = sanitizeInterviewerText(text);
  if (!clean || !previousLines || !previousLines.length) return clean;
  const parts = splitSentences(clean);
  while (parts.length > 1 && isStaleRepeatSentence(parts[parts.length - 1], previousLines)) parts.pop();
  return parts.join("").replace(/\s+/g, " ").trim();
}
