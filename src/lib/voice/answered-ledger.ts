/**
 * Server-side ledger of questions already answered in a voice interview.
 * Applies to EVERY scripted question (not just screening). The model can
 * still speak freely; this module detects verbal re-asks of locked topics
 * and builds prompt blocks so the relay can correct them.
 */

export type LedgerEntry = {
  index: number;
  questionText: string;
  answerSnippet: string;
};

export type AnsweredLedger = {
  entries: LedgerEntry[];
};

import { devanagariToRoman } from "@/lib/transcript/transliterate";

const MAX_ANSWER_CHARS = 200;

/** Phrases that mean the model is reopening a finished topic or restarting. */
export const REOPEN_PHRASE_RE =
  /\b(just\s+to\s+confirm|heading\s+back|going\s+back|go\s+back\s+to|reiterate|could\s+you\s+tell\s+me\s+again|can\s+you\s+reiterate|tell\s+me\s+again|once\s+more|one\s+more\s+time|sorry[,.]?\s+we\s+got\s+disconnected|my\s+apologies[,.]?\s+going\s+back|covers?\s+all\s+our\s+key|that\s+covers\s+all|back\s+to\s+(the\s+)?(first|earlier|previous)|returning\s+to\s+(the\s+)?(first|earlier|previous)|walk\s+us\s+through\s+(your\s+)?(work|experience)\s+at)\b/i;

/** Candidate presence after a silence prompt — not a new answer. */
export const PRESENCE_ACK_RE =
  /^(yes|yeah|yep|yup|ok|okay|i(?:'?m| am)\s+here|((i\s+)?can\s+hear(\s+you)?)|still\s+connected|i(?:'?m| am)\s+connected|connected|你好|在|能听到|听得到|haa?n(\s+ji)?|ji(\s+haa?n)?|ha+|main\s+yaha+n\s+hu+n?|sun\s+(raha|rahi)\s+hu+n?|(haa?n\s+)?(awaaz|aavaaz|avaaz)\s+aa\s+rahi\s+hai)[.!?]?\s*$/i;

const SCREENING_Q_RE =
  /\b(ctc|salary|lpa|compensation|package|relocat|commit(ment)?|notice\s+period|willing\s+to\s+(relocate|move)|expected\s+(ctc|salary)|current\s+(ctc|salary)|bond|joining)\b/i;

const SCREENING_A_RE =
  /^(yes|yeah|yep|yup|no|nope|ok|okay|sure|negotiable|haa?n(\s+ji)?|ji(\s+haa?n)?|ji\s+nahi+n?|nahi+n?|bilkul|theek\s+hai|([\d.,]+\s*(lpa|lakhs?|k|rs\.?|inr)?(\s*(to|-|–)\s*[\d.,]+\s*(lpa|lakhs?|k)?)?)(\s*,?\s*negotiable)?)[.!]?\s*$/i;

/** Filler / incomplete — not enough to lock a question. */
const NON_ANSWER_RE =
  /^(and|but|or|um+|uh+|uhm+|hmm+|mm+|er+|ah+|like|so|then|well|okay so|ok so|toh|to|matlab|accha|achha|haa?n\s+toh)[.…]?\s*$/i;

const STOP = new Set([
  "the", "and", "for", "that", "with", "this", "from", "your", "you", "are", "was",
  "were", "have", "has", "had", "been", "will", "would", "could", "should", "about",
  "into", "what", "when", "where", "which", "how", "who", "why", "can", "did", "does",
  "please", "tell", "me", "us", "our", "their", "they", "them", "his", "her", "its",
  "not", "but", "also", "just", "like", "some", "any", "all", "more", "very", "than",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of normalize(text).split(" ")) {
    if (t.length >= 3 && !STOP.has(t)) out.add(t);
  }
  return out;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

/** Contiguous n-gram from the question appears in speech, or long prefix contained. */
export function questionEchoed(spoken: string, questionText: string): boolean {
  const sn = normalize(spoken);
  const qn = normalize(questionText);
  if (!sn || !qn) return false;

  // Long prefix / almost-full question embedded in speech
  if (qn.length >= 24) {
    const prefix = qn.slice(0, Math.min(qn.length, 90));
    if (sn.includes(prefix)) return true;
  }
  if (qn.length >= 16 && sn.includes(qn)) return true;

  const qWords = qn.split(" ").filter(Boolean);
  const gram = qWords.length >= 8 ? 6 : qWords.length >= 5 ? 4 : 0;
  if (gram > 0) {
    for (let i = 0; i <= qWords.length - gram; i++) {
      const slice = qWords.slice(i, i + gram).join(" ");
      if (slice.length >= 12 && sn.includes(slice)) return true;
    }
  }

  const qTok = tokens(questionText);
  const sTok = tokens(spoken);
  if (qTok.size >= 4 && overlapRatio(sTok, qTok) >= 0.4) return true;
  if (qTok.size >= 3 && overlapRatio(sTok, qTok) >= 0.55) return true;
  return false;
}

export function emptyLedger(): AnsweredLedger {
  return { entries: [] };
}

export function isLocked(ledger: AnsweredLedger, index: number): boolean {
  return ledger.entries.some((e) => e.index === index);
}

/** Truncate and clean a candidate answer for the locked block. */
export function clipAnswerSnippet(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(answered)";
  return t.length > MAX_ANSWER_CHARS ? `${t.slice(0, MAX_ANSWER_CHARS)}…` : t;
}

/**
 * Record (or replace) a locked answer for a question index.
 * Call on forward moveTo, or as soon as any substantive answer lands.
 */
export function recordAnswer(
  ledger: AnsweredLedger,
  index: number,
  questionText: string,
  answerText: string | null | undefined,
): AnsweredLedger {
  if (!Number.isInteger(index) || index < 0) return ledger;
  const entry: LedgerEntry = {
    index,
    questionText: (questionText ?? "").trim(),
    answerSnippet: clipAnswerSnippet(answerText),
  };
  const rest = ledger.entries.filter((e) => e.index !== index);
  return { entries: [...rest, entry].sort((a, b) => a.index - b.index) };
}

/** Prompt block injected into system / correction cues. Empty string if nothing locked. */
export function ledgerPromptBlock(ledger: AnsweredLedger, isZh = false): string {
  if (!ledger.entries.length) return "";
  if (isZh) {
    const lines = ledger.entries
      .map((e) => `  - 第${e.index + 1}题「${e.questionText}」→ 已答：${e.answerSnippet}`)
      .join("\n");
    return `## 已锁定答案（禁止再问、禁止"再确认一下"、禁止"回到上一题"）\n${lines}\n`;
  }
  const lines = ledger.entries
    .map((e) => `  - Q${e.index + 1}: "${e.questionText}" → "${e.answerSnippet}"`)
    .join("\n");
  return `## LOCKED (never re-ask / never "just confirm" / never "heading back")\n${lines}\n`;
}

/** Silent context refresh after locking (no spoken output). */
export function ledgerRefreshCue(ledger: AnsweredLedger, isZh = false): string {
  const block = ledgerPromptBlock(ledger, isZh).trim();
  if (!block) return "";
  if (isZh) {
    return `[SYSTEM] 锁定列表已更新。绝对不要再问或再确认这些题：\n${block}`;
  }
  return `[SYSTEM] Locked-answer list updated. NEVER re-ask or reconfirm these questions:\n${block}`;
}

/** Correction cue after the model verbally reopens a locked topic. */
export function reaskCorrectionCue(
  ledger: AnsweredLedger,
  currentIndex: number,
  currentQuestionText: string,
  isZh = false,
): string {
  const lock = ledgerPromptBlock(ledger, isZh).trim();
  const currentLocked = isLocked(ledger, currentIndex);
  if (isZh) {
    if (currentLocked) {
      return `[SYSTEM] 你刚才又把第${currentIndex + 1}题的题干问了一遍，但受访者已经答过。立刻停止重复题干。可以简短追问细节，或调用 signal_question_change 进入下一题。不要再朗读已锁定的原文。${lock ? `\n${lock}` : ""}`;
    }
    return `[SYSTEM] 你刚才重复了已经问过的题目。立刻停止。当前只能继续第${currentIndex + 1}题："${currentQuestionText}"。不要再确认已锁定的答案。${lock ? `\n${lock}` : ""}`;
  }
  if (currentLocked) {
    return `[SYSTEM] You just re-asked question ${currentIndex + 1}'s scripted text, but the participant already answered it. Stop repeating the scripted question. Ask a short follow-up OR call signal_question_change to move on — do NOT read the locked question again.${lock ? `\n${lock}` : ""}`;
  }
  return `[SYSTEM] You just re-asked or re-confirmed a question that is already LOCKED. Stop. Stay on question ${currentIndex + 1} only: "${currentQuestionText}". Acknowledge briefly if needed, then continue THIS question — do NOT reconfirm locked answers.${lock ? `\n${lock}` : ""}`;
}

/**
 * True when spoken assistant text reopens a finished question.
 * Checks ALL locked entries, including the current index once answered
 * (catches re-reading the same scripted question after a valid answer).
 */
export function looksLikeReask(
  spoken: string | null | undefined,
  ledger: AnsweredLedger,
  currentIndex: number,
): boolean {
  const text = (spoken ?? "").replace(/\s+/g, " ").trim();
  if (!text || ledger.entries.length === 0) return false;

  const spokenTok = tokens(text);
  const reopen = REOPEN_PHRASE_RE.test(text);

  for (const e of ledger.entries) {
    // Strong: scripted question echoed in speech (any locked Q, incl. current)
    if (questionEchoed(text, e.questionText)) return true;

    const qTok = tokens(e.questionText);
    const overlap = overlapRatio(spokenTok, qTok);

    // Soft overlap + reopen / restart phrasing
    if (reopen && overlap >= 0.2) return true;

    // Answer facts echoed back as a confirm question
    const aTok = tokens(e.answerSnippet);
    if (
      e.answerSnippet !== "(answered)" &&
      e.answerSnippet !== "(answered earlier)" &&
      aTok.size >= 2 &&
      (reopen || /\b(confirm|again|expected|comfortable|willing)\b/i.test(text)) &&
      overlapRatio(spokenTok, aTok) >= 0.45
    ) {
      return true;
    }

    // Non-current locked Q with solid topical overlap even without reopen phrase
    if (e.index !== currentIndex && qTok.size >= 4 && overlap >= 0.5) return true;
  }

  // Restart / wrap-up theater while earlier Qs are locked
  if (reopen && ledger.entries.some((e) => e.index !== currentIndex)) {
    if (/\b(first\s+question|question\s+1\b|earlier\s+question|previous\s+question)\b/i.test(text)) {
      return true;
    }
  }

  return false;
}

/** Candidate only confirmed they are still on the call after a silence prompt. */
export function isPresenceAck(text: string | null | undefined): boolean {
  const t = devanagariToRoman(text ?? "").replace(/\s+/g, " ").trim();
  return !!t && PRESENCE_ACK_RE.test(t);
}

/**
 * The candidate is talking ABOUT the interview, not answering it: "I haven't
 * answered", "you skipped", "wait", "can you repeat", "let me finish"…
 * Such a turn needs a reply, but it never counts as an answer.
 */
const META_STRONG_RE = [
  /\b(i|we)\s+(have\s+not|haven'?t|had\s+not|hadn'?t|did\s+not|didn'?t|am\s+not|'?m\s+not|was\s+not|wasn'?t)\s+(yet\s+)?(answer(ed)?|finish(ed)?|done|complete(d)?)\b/i,
  /\b(not|never)\s+(yet\s+)?(answered|finished)\b/i,
  /\byou\s+(have\s+)?(skipped|jumped|moved\s+on|cut\s+me|interrupted|didn'?t\s+let\s+me|did\s+not\s+let\s+me|asked\s+me\s+(about\s+)?\w+\s+(and\s+)?(now|before))/i,
  /\b(you\s+are|you'?re)\s+(skipping|jumping|moving)\b/i,
  /\b(let\s+me\s+finish|i\s+was\s+(still\s+)?(speaking|saying|answering|talking)|i\s+wasn'?t\s+(done|finished))\b/i,
  /\b(can|could|will|would)\s+you\s+(please\s+)?(repeat|say\s+(that|it)\s+again|ask\s+(that|it|the\s+question)\s+again)\b/i,
  /\bi\s+(didn'?t|did\s+not|couldn'?t|could\s+not)\s+(hear|catch|understand|get)\s+(you|that|the\s+question|it)\b/i,
  /(你跳过了|我还没(有)?回答|我还没说完|请再说一遍|请重复)/,
  // Hindi / Hinglish (Devanagari is romanised first): "maine jawab nahi diya", "aapne skip kiya", "phir se boliye"…
  /\b(maine|mai+ne|main\s+ne)\s+(abhi\s+(tak\s+)?)?(ja(w|v)a+b|answer)\s+(abhi\s+)?nahi+n?\s+(diya|kiya|diya\s+hai)\b/i,
  /\b(mera|meraa)\s+(ja?wa+b|ja?va+b|answer)\s+(abhi\s+)?(pura|poora|puraa|complete|khatam)\s+nahi+n?\b/i,
  /\b(aapne|apne|aap\s?ne|tumne)\s+([\p{L}]+\s+){0,3}(skip|chhod|chod)\s+(kar\s+)?(diya|kiya|di|dia)\b/iu,
  /\b(aapne|apne|aap\s?ne)\s+(mujhe\s+)?(beech\s+mein\s+)?(rok|kaat|kat)\s+(diya|di)\b/i,
  /\b(mujhe\s+)?(baat|ja?wa+b|ja?va+b)\s+(puri|poori|pura|poora)\s+(karne|karane)\s+(do|dijiye|dijie|deejiye)\b/i,
  /\b(phir\s+se|fir\s+se|dobara|dobaara|ek\s+baar\s+(aur|phir))\s+(bol|bataa?|pooch|puch|samjha|repeat)\w*\b/i,
  /\b(repeat|dohra)\s*(kijiye|kijie|karo|kariye|karie|karenge|kar\s+(do|dijiye|dijie|sakte))\b/i,
  /\b(sunai|samajh|samjh)\s+nahi+n?\s+(aaya|aya|diya|dia|aayi)\b/i,
];
/** Only when the whole turn is short: a bare "wait" / "pardon". */
const META_SHORT_RE =
  /^(wait|hold\s+on|one\s+(second|moment|sec)|just\s+a\s+(second|moment|sec)|sorry|pardon|excuse\s+me|what|huh|repeat|again|hell?o+|hallo+|hi+|hey|ruko|rukiye|rukie|ruk\s+jaa?(o|iye|ie)|zara\s+ruk\w*|ek\s+(minute|minat|min|second|sec|pal|second)|kya\s+(bola|kaha|kahaa)|kya)\b[\s\S]{0,40}$/i;

export function isMetaReply(text: string | null | undefined): boolean {
  const a = devanagariToRoman(text ?? "").replace(/\s+/g, " ").trim();
  if (!a) return false;
  const words = a.split(/\s+/).length;
  if (words <= 60 && META_STRONG_RE.some((re) => re.test(a))) return true;
  if (isPresenceCheck(a)) return true;
  return words <= 6 && META_SHORT_RE.test(a);
}

/**
 * A meta reply that says a question was skipped / not answered (go back to it),
 * as opposed to "wait" / "repeat please" (just stay). `skipped` prefers an
 * earlier question over the current one.
 */
export function metaComplaintKind(text: string | null | undefined): { complaint: boolean; skipped: boolean } {
  const t = devanagariToRoman(text ?? "");
  const skipped = /skipp|\bskip\s+(kar|kiya|ho)|jump|跳过|\b(chhod|chod)\s+(diya|di|dia)/i.test(t);
  const complaint = skipped
    || /moved?\s+on|cut\s+me|interrupt|haven'?t\s+answer|have\s+not\s+answer|not\s+(yet\s+)?answered|let\s+me\s+finish|wasn'?t\s+(done|finished)|还没/i.test(t)
    || /\bja(w|v)a+b\s+(abhi\s+)?(nahi+n?\s+diya|(pura|poora|puraa|complete)\s+nahi)|\b(rok|kaat|kat)\s+(diya|di)\b|\b(puri|poori|pura|poora)\s+(karne|karane)\s+(do|dijiye|dijie)/i.test(t);
  return { complaint, skipped };
}

const FILLER_WORD_RE = /^(and|but|or|um+|uh+|uhm+|hmm+|mm+|er+|ah+|like|so|then|well|okay|ok|yes|yeah|yep|no|right|actually|basically|haa?n|ji|nahi+n?|toh|to|matlab|accha|achha|aur|ki|ke|ka|hai|hain|na)$/i;
/** Content words a non-screening answer needs before the question counts as answered. */
export const MIN_ANSWER_CONTENT_WORDS = 3;

/**
 * A real candidate answer to THIS question. Interviewer text, silence / system
 * cues and meta replies never count. A bare "Yes" only answers a yes/no or
 * screening question; everything else needs some content.
 * Without `questionText` only the shape of the reply is checked.
 */
export function isSubstantiveCandidateAnswer(
  text: string | null | undefined,
  questionText?: string | null,
): boolean {
  const a = devanagariToRoman(text ?? "").replace(/\s+/g, " ").trim();
  if (!a || NON_ANSWER_RE.test(a)) return false;
  // Relay cues ("[SILENCE_PROMPT] …", "[SYSTEM] …") are never the candidate speaking
  if (a.startsWith("[")) return false;
  // Skip / nav commands are not answers to the scripted Q
  if (/^(skip|next( question)?|previous( question)?|go back|下一题|上一题|跳过)[.!]?\s*$/i.test(a)) {
    return false;
  }
  if (isMetaReply(a)) return false;
  const words = a.split(/\s+/).filter(Boolean);
  if (questionText === undefined) {
    // Shape only (no question known): one clear word can still be valid ("Yes", "React", "3 LPA")
    if (words.length === 1) return a.length >= 2;
    return words.length >= 2;
  }
  if (isSufficientShortAnswer(questionText, a)) return true;
  const content = words.filter((w) => !FILLER_WORD_RE.test(w.replace(/[^\p{L}\p{N}]/gu, ""))).length;
  return content >= MIN_ANSWER_CONTENT_WORDS;
}

/** Drop a locked entry (the question was re-opened because it was never really answered). */
export function reopenQuestion(ledger: AnsweredLedger, index: number): AnsweredLedger {
  return { entries: ledger.entries.filter((e) => e.index !== index) };
}

/**
 * Screening / yes-no / salary questions can be fully answered in a few words.
 * Used to bypass long-answer word/dwell guards (not for locking — locking uses
 * isSubstantiveCandidateAnswer for every question type).
 */
export function isSufficientShortAnswer(
  questionText: string | null | undefined,
  userText: string | null | undefined,
): boolean {
  const q = devanagariToRoman(questionText ?? "").trim();
  const a = devanagariToRoman(userText ?? "").replace(/\s+/g, " ").trim();
  if (!q || !a) return false;
  if (!SCREENING_Q_RE.test(q) && !/\?/.test(q)) return false;
  if (SCREENING_Q_RE.test(q) && (SCREENING_A_RE.test(a) || a.split(/\s+/).length <= 12)) {
    if (/^(and|but|or|um+|uh+)\s*$/i.test(a)) return false;
    return true;
  }
  if (/\b(are you|will you|do you|can you|would you|kya aap|kya tum|kya aapne)\b/i.test(q) && /^(yes|yeah|yep|yup|no|nope|sure|ok|okay|haa?n(\s+ji)?|ji(\s+haa?n)?|ji\s+nahi+n?|nahi+n?|bilkul|theek\s+hai)[.!]?\s*$/i.test(a)) {
    return true;
  }
  return false;
}

const PRESENCE_CHECK_RE = [
  /^((hell?o+|hallo+|halo+|hi+|hey|haay|hai)[\s.,!?]*){1,4}$/i,
  /^(hell?o+[\s,.!?]+)?((can|could)\s+you\s+(please\s+)?hear\s+me|are\s+you\s+there|am\s+i\s+audible|is\s+my\s+(voice|audio)\s+(coming|clear|audible))\b/i,
  /\b(aap|aapko|tum)\s+(mujhe\s+|meri\s+(baat|awaaz|aavaaj|awaj)\s+)?(sun|sunn)\s*(pa\s+|paa\s+)?(rahe|rahi|sakte|sakti)\b/i,
  /\b(meri\s+)?(awaaz|aavaaj|awaz|aawaz|awaj|voice)\s+(aa|a)\s+rahi\b/i,
];

/**
 * "Hello? Hello?" / "can you hear me?" / "aap sun pa rahe hain?": the candidate
 * is only checking the connection. Never an answer, never a reason to go back.
 */
export function isPresenceCheck(text: string | null | undefined): boolean {
  const t = devanagariToRoman(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 10) return false;
  return PRESENCE_CHECK_RE.some((re) => re.test(t));
}

/** Reply to a connection check: one "yes, I can hear you", then the CURRENT question. */
export function presenceCheckCue(
  currentIndex: number,
  currentQuestionText: string,
  opts: { isZh?: boolean; hindi?: boolean; asked?: boolean } = {},
): string {
  if (opts.isZh) {
    return `[SYSTEM] 受访者只是在确认连线（"喂/你能听到吗"）。用一句话告诉对方你能听到，然后继续第${currentIndex + 1}题："${currentQuestionText}"${opts.asked ? "（已经问过的话，用自己的话简短重复一次）" : ""}。不要回到之前的题目，不要问对方能否听到你，不要调用任何函数。`;
  }
  const yes = opts.hindi ? `"Haan, aapki awaaz aa rahi hai."` : `"Yes, I can hear you."`;
  const next = opts.asked
    ? `repeat question ${currentIndex + 1} once, briefly and in your own words`
    : `ask question ${currentIndex + 1} now`;
  return `[SYSTEM] The participant is only checking the connection ("hello" / "can you hear me"). This is NOT an answer. Say one short line such as ${yes}, then ${next}: "${currentQuestionText}". Never go back to an earlier question, never ask whether they can hear you, and do not call any function.`;
}

/** Cue after silence prompt when the candidate only said they are present. */
export function silencePresenceAckCue(
  currentIndex: number,
  currentQuestionText: string,
  isZh = false,
): string {
  if (isZh) {
    return `[SYSTEM] 受访者只是确认还在线（例如"在"/"能听到"）。不要重复第${currentIndex + 1}题的题干。可以简短回应，然后等待他们继续回答："${currentQuestionText}"。不要调用任何函数，不要换题，不要"再确认"已锁定的内容。`;
  }
  return `[SYSTEM] The participant only confirmed they are still connected (e.g. "yes" / "I can hear you"). Do NOT repeat question ${currentIndex + 1}'s scripted text. Briefly acknowledge, then wait for them to continue answering: "${currentQuestionText}". Do not call any function, do not change questions, and do not reconfirm LOCKED answers.`;
}

/** The participant says a question was skipped / they have not answered: go back to exactly that one. */
export function reopenQuestionCue(index: number, questionText: string, isZh = false): string {
  if (isZh) {
    return `[SYSTEM] 受访者指出第${index + 1}题被跳过或他们还没有回答。简短道歉一次，然后只问这一题（只问一个问题）："${questionText}"。等他们回答。回答之后按顺序继续下一道尚未问过的题，不要漏题。现在不要调用 signal_question_change。`;
  }
  return `[SYSTEM] The participant says question ${index + 1} was skipped or that they have not answered. Apologise once in a few words, then ask ONLY this question (one question, nothing else): "${questionText}". Wait for their answer. Do not call signal_question_change now. After they answer, continue with the next question that has not been asked yet, in order, and never drop a question.`;
}

/** Reply to a meta turn ("wait", "can you repeat") on a question that is still open. */
export function metaReplyCue(index: number, questionText: string, isZh = false): string {
  if (isZh) {
    return `[SYSTEM] 受访者刚才说的不是对第${index + 1}题的回答（例如要求等待、重复或指出问题）。简短回应，然后继续只围绕这一题让他们回答："${questionText}"。不要换题，不要调用任何函数。`;
  }
  return `[SYSTEM] The participant's last words were NOT an answer to question ${index + 1} (for example "wait", "can you repeat", or a complaint). Reply briefly, then keep the current question open and let them answer it: "${questionText}". Do not change questions and do not call any function.`;
}

/** Hard bans appended to the voice interviewer system prompt. */
export function noReaskBehaviorRules(isZh = false): string {
  if (isZh) {
    return `- 禁止复述或"再确认"任何已经问过并锁定的题目（每一题，不只是筛选题）。不要说"再确认一下"、"回到上一题/第一题"、"请再说一遍"，除非受访者明确要求回到上一题。
- 受访者已经答过当前题后：不要再朗读题干原文；可以追问细节，或调用 signal_question_change 进入下一题。
- 收到 [SILENCE_PROMPT] 且受访者只回复"在/能听到"时：不要重复题干，简短确认后等待他们继续回答当前题。
- 若某题答案已锁定：最多简短致谢一次，绝不再次征求同一事实或同一题干。
- 受访者正在写代码或使用白板时：保持安静，不要提醒"题目在屏幕上"，不要催促，也不要复述题目；只有受访者开口时才回应。
- 每次发言只问一个问题，绝不把多个问题叠在一起。没有收到受访者的新回答之前，不要再次发言，不要说"明白了/我们已经讲过了"这类仿佛对方已回答的话。
- 受访者指出你跳过了某题或他们还没回答：道歉一次，回到那一题并只问那一题；等他们回答后，按顺序继续下一道尚未问过的题，绝不漏题。`
  }
  return `- NEVER re-ask or "just confirm" ANY question that is already LOCKED (every scripted question, not only screening). Forbidden unless the participant asked to go back: "just to confirm", "heading back", "reiterate", "going back to question 1 / the first question", "that covers all our key questions" then restarting earlier topics.
- After the participant has answered the CURRENT question: do NOT read its scripted text again — ask a short follow-up OR call signal_question_change to move on.
- After a [SILENCE_PROMPT], if the participant only says they are present ("yes", "I can hear you"): do NOT repeat the scripted question — briefly acknowledge and wait for them to continue the CURRENT question.
- Once an answer is LOCKED: acknowledge at most once; never re-solicit that same fact or re-read that question.
- While the participant is writing code or using the whiteboard: stay quiet. Do NOT remind them the problem is on their screen, do not nudge, and do not re-read the question. Never respond to [CODE_UPDATE] or [WHITEBOARD_UPDATE]; speak only when the participant speaks to you.
- Ask EXACTLY ONE question per turn. Never stack two or three questions in one message, and never tack the next topic onto a follow-up.
- After you speak, WAIT for the participant. Never speak twice in a row. Never say "that makes sense", "we've already covered that" or "moving on" unless the participant actually answered in their own words just now.
- Only the participant's own spoken answer counts. Your own words, silence, system messages, and replies like "wait", "I haven't answered" or "can you repeat" are NOT answers.
- If the participant points out you skipped a question or they haven't answered: apologise once, go back to THAT question and ask only it. After they answer, continue with the next question not yet asked, in order. Never drop a question.`;
}

// ── Answers given early for a later screening question ────────────────

export type ScreeningTopic = "expected_ctc" | "current_ctc" | "notice_period" | "relocation";

const TOPIC_Q: Record<ScreeningTopic, RegExp> = {
  expected_ctc: /\b(expect\w*\s+(ctc|salary|compensation|package|pay)|(ctc|salary|compensation|package)\s+expectations?|compensation\s+expectations?)\b/i,
  current_ctc: /\b(current|present|existing)\s+(ctc|salary|compensation|package|pay)\b/i,
  notice_period: /\b(notice\s+period|how\s+soon\s+(can|could)\s+you\s+(join|start)|when\s+can\s+you\s+(join|start)|joining\s+(date|timeline))\b/i,
  relocation: /\b(relocat\w*|willing\s+to\s+(move|shift)|location\s+preference|preferred\s+location|work\s+from\s+(the\s+)?office)\b/i,
};

const AMOUNT = String.raw`\d[\d.,]*\s*(lpa|lakhs?|lacs?|l\b|k\b|ctc|per\s+annum)?`;
const TOPIC_A: Record<ScreeningTopic, RegExp[]> = {
  expected_ctc: [
    new RegExp(String.raw`\b(expect\w*|expectation)\b[^.?!]{0,40}${AMOUNT}`, "i"),
    new RegExp(String.raw`${AMOUNT}[^.?!]{0,25}\b(expect\w*|expectation)\b`, "i"),
  ],
  current_ctc: [
    new RegExp(String.raw`\b(current|currently|present|abhi|abhi\s+ka|filhaal)\b[^.?!]{0,30}\b(ctc|salary|package)\b[^.?!]{0,30}\d`, "i"),
    new RegExp(String.raw`\b(ctc|salary|package)\b[^.?!]{0,20}\b(current|currently|abhi|filhaal)\b[^.?!]{0,30}\d`, "i"),
  ],
  notice_period: [
    /\bnotice\s+period\b[^.?!]{0,40}(\d+|immediate|serving|one|two|three|ek|do|teen|nahi|no)\b/i,
    /\b(immediate(ly)?\s+(join|joiner|available)|serving\s+(my\s+)?notice|join\s+immediately)\b/i,
  ],
  relocation: [
    /\b(relocat\w*|shift\s+(ho|kar)\w*|move\s+to\s+\w+)\b/i,
    /\b(location|city)\b[^.?!]{0,30}\b(prefer\w*|anywhere|kahin\s+bhi|pune|bangalore|bengaluru|mumbai|delhi|noida|gurgaon|gurugram|hyderabad|chennai|kolkata|ahmedabad|indore|jaipur|lucknow)\b/i,
  ],
};

/** The screening topic a question asks about (expected / current CTC, notice period, relocation), if any. */
export function screeningTopic(questionText: string | null | undefined): ScreeningTopic | null {
  const q = devanagariToRoman(questionText ?? "");
  for (const t of Object.keys(TOPIC_Q) as ScreeningTopic[]) if (TOPIC_Q[t].test(q)) return t;
  return null;
}

/** Screening topics a candidate answer already covers ("expected 15-16 LPA, relocate kar sakta hoon"). */
export function answeredScreeningTopics(answer: string | null | undefined): Set<ScreeningTopic> {
  const a = devanagariToRoman(answer ?? "");
  const out = new Set<ScreeningTopic>();
  for (const t of Object.keys(TOPIC_A) as ScreeningTopic[]) if (TOPIC_A[t].some((re) => re.test(a))) out.add(t);
  return out;
}

/**
 * Later, not-yet-asked questions this answer already answers (so they are
 * locked and never asked again). Only clear screening topics, never open questions.
 */
export function earlyAnsweredQuestions(
  answer: string | null | undefined,
  questions: ReadonlyArray<{ text?: string | null }>,
  current: number,
  isDone: (index: number) => boolean,
): number[] {
  const topics = answeredScreeningTopics(answer);
  if (!topics.size) return [];
  const out: number[] = [];
  for (let i = current + 1; i < questions.length; i++) {
    if (isDone(i)) continue;
    const t = screeningTopic(questions[i]?.text);
    if (t && topics.has(t)) out.push(i);
  }
  return out;
}
