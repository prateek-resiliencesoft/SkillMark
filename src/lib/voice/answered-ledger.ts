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

const MAX_ANSWER_CHARS = 200;

/** Phrases that mean the model is reopening a finished topic or restarting. */
export const REOPEN_PHRASE_RE =
  /\b(just\s+to\s+confirm|heading\s+back|going\s+back|go\s+back\s+to|reiterate|could\s+you\s+tell\s+me\s+again|can\s+you\s+reiterate|tell\s+me\s+again|once\s+more|one\s+more\s+time|sorry[,.]?\s+we\s+got\s+disconnected|my\s+apologies[,.]?\s+going\s+back|covers?\s+all\s+our\s+key|that\s+covers\s+all|back\s+to\s+(the\s+)?(first|earlier|previous)|returning\s+to\s+(the\s+)?(first|earlier|previous)|walk\s+us\s+through\s+(your\s+)?(work|experience)\s+at)\b/i;

/** Candidate presence after a silence prompt — not a new answer. */
export const PRESENCE_ACK_RE =
  /^(yes|yeah|yep|yup|ok|okay|i(?:'?m| am)\s+here|((i\s+)?can\s+hear(\s+you)?)|still\s+connected|i(?:'?m| am)\s+connected|connected|你好|在|能听到|听得到)[.!?]?\s*$/i;

const SCREENING_Q_RE =
  /\b(ctc|salary|lpa|compensation|package|relocat|commit(ment)?|notice\s+period|willing\s+to\s+(relocate|move)|expected\s+(ctc|salary)|current\s+(ctc|salary)|bond|joining)\b/i;

const SCREENING_A_RE =
  /^(yes|yeah|yep|yup|no|nope|ok|okay|sure|negotiable|([\d.,]+\s*(lpa|lakhs?|k|rs\.?|inr)?(\s*(to|-|–)\s*[\d.,]+\s*(lpa|lakhs?|k)?)?)(\s*,?\s*negotiable)?)[.!]?\s*$/i;

/** Filler / incomplete — not enough to lock a question. */
const NON_ANSWER_RE =
  /^(and|but|or|um+|uh+|uhm+|hmm+|mm+|er+|ah+|like|so|then|well|okay so|ok so)[.…]?\s*$/i;

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
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return !!t && PRESENCE_ACK_RE.test(t);
}

/**
 * Any real candidate turn that should lock the current question early.
 * Trailing fillers / nav commands do not count. (Presence-only "yes" after a
 * silence prompt is filtered by the relay before this is called.)
 */
export function isSubstantiveCandidateAnswer(text: string | null | undefined): boolean {
  const a = (text ?? "").replace(/\s+/g, " ").trim();
  if (!a || NON_ANSWER_RE.test(a)) return false;
  // Skip / nav commands are not answers to the scripted Q
  if (/^(skip|next( question)?|previous( question)?|go back|下一题|上一题|跳过)[.!]?\s*$/i.test(a)) {
    return false;
  }
  const words = a.split(/\s+/).filter(Boolean);
  // One clear word can still be a valid answer ("Yes", "React", "3 LPA")
  if (words.length === 1) return a.length >= 2;
  return words.length >= 2;
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
  const q = (questionText ?? "").trim();
  const a = (userText ?? "").replace(/\s+/g, " ").trim();
  if (!q || !a) return false;
  if (!SCREENING_Q_RE.test(q) && !/\?/.test(q)) return false;
  if (SCREENING_Q_RE.test(q) && (SCREENING_A_RE.test(a) || a.split(/\s+/).length <= 12)) {
    if (/^(and|but|or|um+|uh+)\s*$/i.test(a)) return false;
    return true;
  }
  if (/\b(are you|will you|do you|can you|would you)\b/i.test(q) && /^(yes|yeah|yep|yup|no|nope|sure|ok|okay)[.!]?\s*$/i.test(a)) {
    return true;
  }
  return false;
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

/** Hard bans appended to the voice interviewer system prompt. */
export function noReaskBehaviorRules(isZh = false): string {
  if (isZh) {
    return `- 禁止复述或"再确认"任何已经问过并锁定的题目（每一题，不只是筛选题）。不要说"再确认一下"、"回到上一题/第一题"、"请再说一遍"，除非受访者明确要求回到上一题。
- 受访者已经答过当前题后：不要再朗读题干原文；可以追问细节，或调用 signal_question_change 进入下一题。
- 收到 [SILENCE_PROMPT] 且受访者只回复"在/能听到"时：不要重复题干，简短确认后等待他们继续回答当前题。
- 若某题答案已锁定：最多简短致谢一次，绝不再次征求同一事实或同一题干。
- 受访者正在写代码或使用白板时：保持安静，不要提醒"题目在屏幕上"，不要催促，也不要复述题目；只有受访者开口时才回应。`;
  }
  return `- NEVER re-ask or "just confirm" ANY question that is already LOCKED (every scripted question, not only screening). Forbidden unless the participant asked to go back: "just to confirm", "heading back", "reiterate", "going back to question 1 / the first question", "that covers all our key questions" then restarting earlier topics.
- After the participant has answered the CURRENT question: do NOT read its scripted text again — ask a short follow-up OR call signal_question_change to move on.
- After a [SILENCE_PROMPT], if the participant only says they are present ("yes", "I can hear you"): do NOT repeat the scripted question — briefly acknowledge and wait for them to continue the CURRENT question.
- Once an answer is LOCKED: acknowledge at most once; never re-solicit that same fact or re-read that question.
- While the participant is writing code or using the whiteboard: stay quiet. Do NOT remind them the problem is on their screen, do not nudge, and do not re-read the question. Never respond to [CODE_UPDATE] or [WHITEBOARD_UPDATE]; speak only when the participant speaks to you.`;
}
