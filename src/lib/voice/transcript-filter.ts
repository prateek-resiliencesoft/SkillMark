/**
 * Candidate speech-to-text clean-up (pure, unit-tested). Live speech
 * recognition invents text on silence, noise and speaker echo ("Thank you for
 * watching", "subscribe", the same phrase five times, Urdu / Bengali / Japanese
 * script in a Hindi interview, or the interviewer's own words picked up by the
 * mic). Such text must never be shown, saved, or counted as an answer.
 */
import { devanagariToRoman } from "@/lib/transcript/transliterate";

export type TranscriptDropReason = "empty" | "hallucination" | "wrong_script" | "echo" | "silence";

export type CleanTranscriptOptions = {
  /** Interview / session language code ("en", "hi", "multi", "zh"…). */
  language?: string | null;
  /** What the interviewer said most recently (echo check). */
  recentAssistant?: string[];
  /** ms of browser audio in this turn whose level reached voice. */
  voicedMs?: number;
  /** ms of browser audio in this turn (any level). */
  audioMs?: number;
};

export type CleanTranscriptResult = { text: string; dropped: TranscriptDropReason | null };

/** Whole-turn phrases speech recognition makes up on silence / noise (lowercase, no punctuation). */
const HALLUCINATION_WHOLE = new Set([
  "you", "thank you", "thanks", "thank you very much", "thank you so much", "bye", "bye bye", "goodbye", "the end",
  "subscribe", "please subscribe", "like and subscribe", "thanks for watching", "thank you for watching",
  "music", "applause", "laughter", "silence", "noise",
  "dhanyavaad", "dhanyavad", "dhanyawad", "shukriya",
]);

/** Phrases that never come from a candidate, removed wherever they appear. */
const HALLUCINATION_ANYWHERE: RegExp[] = [
  /\b(thank\s+you|thanks)\s+for\s+watching\b[.!]?/gi,
  /\b(please\s+)?(like,?\s+(share\s+)?(and\s+)?)?subscribe(\s+to)?\s+(to\s+)?(my|our|the)\s+channel\b[.!]?/gi,
  /\b(don'?t\s+forget\s+to\s+)?(like,?\s+share\s+and\s+subscribe|like\s+and\s+subscribe)\b[.!]?/gi,
  /\bsubtitles?\s+(by|from)\b[^!?\n]*/gi,
  /\b(transcribed|captioned|translated)\s+by\b[^!?\n]*/gi,
  /\bamara\.org\b[^.!?]*[.!?]?/gi,
  /\bchannel\s+ko\s+(like|subscribe|sabsakraaib)[^.!?]*[.!?]?/gi,
  /\b(sabsakraaib|subscribe)\s+(karen|kare|kijiye|karein|karo)\b[.!]?/gi,
  /[[(]\s*(music|applause|laughter|silence|noise|inaudible|background\s+noise)\s*[\])]/gi,
  /[♪♫]+/g,
];

const LETTER_RE = /\p{L}/u;
const LATIN_OR_DEVANAGARI_RE = /[\p{Script=Latin}\p{Script=Devanagari}]/u;
const HAN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function isZhLanguage(language?: string | null): boolean {
  return /^zh|chinese/i.test((language ?? "").trim());
}

/** A letter outside the scripts this interview can produce. */
function isForeignLetter(ch: string, language?: string | null): boolean {
  if (!LETTER_RE.test(ch)) return false;
  if (LATIN_OR_DEVANAGARI_RE.test(ch)) return false;
  if (isZhLanguage(language) && HAN_RE.test(ch)) return false;
  return true;
}

/** Share of letters written in a script the interview does not use (Urdu, Bengali, Japanese… in a Hindi/English one). */
export function foreignScriptRatio(text: string, language?: string | null): number {
  let letters = 0;
  let foreign = 0;
  for (const ch of text) {
    if (!LETTER_RE.test(ch)) continue;
    letters += 1;
    if (isForeignLetter(ch, language)) foreign += 1;
  }
  return letters === 0 ? 0 : foreign / letters;
}

/** "haan haan haan haan" / "I am I am I am I am" → said once. Runs of 3+ identical 1–6 word phrases collapse. */
export function collapseRepeats(text: string): string {
  let words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (let n = 6; n >= 1; n--) {
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      if (i + n * 3 <= words.length) {
        const phrase = words.slice(i, i + n).map(key).join(" ");
        let reps = 1;
        while (
          i + (reps + 1) * n <= words.length &&
          words.slice(i + reps * n, i + (reps + 1) * n).map(key).join(" ") === phrase
        ) reps += 1;
        if (reps >= 3 && phrase.replace(/\s/g, "")) {
          out.push(...words.slice(i, i + n));
          i += reps * n;
          continue;
        }
      }
      out.push(words[i]);
      i += 1;
    }
    words = out;
  }
  return words.join(" ");
}

function plain(text: string): string {
  return devanagariToRoman(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** The whole turn is a phrase recognisers invent on silence ("Thank you.", "Thanks for watching", "Dhanyavaad"). */
export function isKnownHallucination(text: string): boolean {
  const p = plain(text);
  return !p || HALLUCINATION_WHOLE.has(p);
}

function trigrams(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 3 <= words.length; i++) out.push(words.slice(i, i + 3).join(" "));
  return out;
}

/**
 * The mic picked up the interviewer's own voice: most of the "candidate" words
 * appear, in order, in what the interviewer just said.
 */
export function looksLikeEcho(candidate: string, assistantLines: string[] | undefined): boolean {
  if (!assistantLines?.length) return false;
  const cw = plain(candidate).split(" ").filter(Boolean);
  if (cw.length < 4) return false;
  const said = new Set(trigrams(plain(assistantLines.join(" ")).split(" ").filter(Boolean)));
  const grams = trigrams(cw);
  if (grams.length < 2 || said.size === 0) return false;
  const hit = grams.filter((g) => said.has(g)).length;
  return hit / grams.length >= 0.6;
}

/**
 * Clean one finished candidate turn. Returns the text to keep (repeats
 * collapsed, invented phrases and foreign-script words removed) or a reason
 * to drop the whole turn.
 */
export function cleanCandidateTranscript(raw: string | null | undefined, opts: CleanTranscriptOptions = {}): CleanTranscriptResult {
  let text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return { text: "", dropped: "empty" };

  // Audio arrived for this turn but none of it was loud enough to be a voice.
  if (typeof opts.audioMs === "number" && opts.audioMs >= 500 && (opts.voicedMs ?? 0) <= 0) {
    return { text: "", dropped: "silence" };
  }

  const ratio = foreignScriptRatio(text, opts.language);
  if (ratio > 0.5) return { text: "", dropped: "wrong_script" };
  if (ratio > 0) {
    text = text.split(" ").filter((w) => ![...w].some((ch) => isForeignLetter(ch, opts.language))).join(" ");
  }

  for (const re of HALLUCINATION_ANYWHERE) text = text.replace(re, " ");
  text = collapseRepeats(text.replace(/\s+/g, " ").trim());
  if (!text || !/[\p{L}\p{N}]/u.test(text) || isKnownHallucination(text)) return { text: "", dropped: "hallucination" };

  if (looksLikeEcho(text, opts.recentAssistant)) return { text: "", dropped: "echo" };
  return { text, dropped: null };
}

/** Gemini Live `inputAudioTranscription.languageCodes` hints for the interview language. */
export function transcriptionLanguageHints(interviewLanguage?: string | null): string[] {
  const l = (interviewLanguage ?? "").trim().toLowerCase();
  if (l === "multi" || l.startsWith("multi") || l === "hi" || l.startsWith("hi-") || l.includes("hindi") || l.includes("hinglish")) {
    return ["hi-IN", "en-IN"];
  }
  return [];
}
