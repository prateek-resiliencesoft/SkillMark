/**
 * Canonical interview spoken/content language codes.
 * UI locale (app chrome en|zh) is separate — see app-locale-provider.
 */

export const INTERVIEW_LANGUAGE_CODES = ["en", "zh", "hi", "es", "fr"] as const;
export type InterviewLanguage = (typeof INTERVIEW_LANGUAGE_CODES)[number];

export const INTERVIEW_LANGUAGE_DISPLAY: Record<InterviewLanguage, string> = {
  en: "English",
  zh: "简体中文 (Simplified Chinese)",
  hi: "Hinglish (Hindi-English mix)",
  es: "Spanish (Español)",
  fr: "French (Français)",
};

/** Spoken/written style rules for interview content (especially Hindi → Hinglish). */
export const INTERVIEW_LANGUAGE_STYLE: Record<InterviewLanguage, string> = {
  en: "Clear, natural English.",
  zh: "Natural Simplified Chinese.",
  hi: [
    "Use Hinglish — everyday spoken Hindi mixed with common English,",
    "the way educated Indian professionals talk in interviews.",
    "Hindi sentence flow is fine; keep technical/business terms in English",
    "(experience, project, team, leadership, API, database, framework, etc.).",
    "Prefer simple spoken Hindi over pure/literary/Sanskritized Hindi.",
    "Example tone: \"Aapka experience kitna hai? Is project mein aapne kaunsa approach use kiya?\"",
    "Do not use pure English-only or shuddh Hindi-only replies.",
    "Any written text must be in Roman script (Hinglish), never Devanagari.",
  ].join(" "),
  es: "Natural conversational Spanish.",
  fr: "Natural conversational French.",
};

/** BCP-47 / speech-synthesis style locales. */
export const INTERVIEW_SPEECH_LOCALE: Record<InterviewLanguage, string> = {
  en: "en-US",
  zh: "zh-CN",
  hi: "hi-IN",
  es: "es-ES",
  fr: "fr-FR",
};

/** Gemini Live `speechConfig.languageCode` values. */
export const INTERVIEW_GEMINI_LANGUAGE_CODE: Record<InterviewLanguage, string> = {
  en: "en-US",
  zh: "cmn-CN",
  hi: "hi-IN",
  es: "es-ES",
  fr: "fr-FR",
};

export function resolveInterviewLanguage(
  language?: string | null,
): InterviewLanguage {
  if (!language) return "en";
  const normalized = language.trim().toLowerCase();
  // Multi-language interviews have no single language: English is the base
  // (questions, reports); the session runs in the candidate's choice.
  if (normalized === MULTI_LANGUAGE || normalized.startsWith("multi")) return "en";

  if (
    normalized === "zh" ||
    normalized.startsWith("zh-") ||
    normalized === "zh_hans" ||
    normalized.includes("chinese") ||
    normalized.includes("中文")
  ) {
    return "zh";
  }
  if (
    normalized === "hi" ||
    normalized.startsWith("hi-") ||
    normalized.includes("hindi") ||
    normalized.includes("hinglish") ||
    normalized.includes("हिन्दी") ||
    normalized.includes("हिंदी")
  ) {
    return "hi";
  }
  if (
    normalized === "es" ||
    normalized.startsWith("es-") ||
    normalized.includes("spanish") ||
    normalized.includes("español")
  ) {
    return "es";
  }
  if (
    normalized === "fr" ||
    normalized.startsWith("fr-") ||
    normalized.includes("french") ||
    normalized.includes("français")
  ) {
    return "fr";
  }
  if (normalized === "en" || normalized.startsWith("en-") || normalized.includes("english")) {
    return "en";
  }
  return "en";
}

export function getInterviewLanguageDisplayName(
  language?: string | null,
): string {
  return INTERVIEW_LANGUAGE_DISPLAY[resolveInterviewLanguage(language)];
}

export function getInterviewSpeechLocale(language?: string | null): string {
  return INTERVIEW_SPEECH_LOCALE[resolveInterviewLanguage(language)];
}

export function getGeminiInterviewLanguageCode(
  language?: string | null,
): string {
  return INTERVIEW_GEMINI_LANGUAGE_CODE[resolveInterviewLanguage(language)];
}

export function isChineseInterviewLanguage(language?: string | null): boolean {
  return resolveInterviewLanguage(language) === "zh";
}

export function getInterviewLanguageStyle(language?: string | null): string {
  return INTERVIEW_LANGUAGE_STYLE[resolveInterviewLanguage(language)];
}

/** Prompt line forcing the interviewer model to stay in the interview language. */
export function interviewLanguageRequirement(
  language?: string | null,
): string {
  if (isMultiLanguage(language)) return multiLanguageRequirement("en");
  const key = resolveInterviewLanguage(language);
  if (key === "zh") {
    return "你必须始终用中文进行面试。你必须用中文回答。不要使用其他语言。";
  }
  if (key === "hi") {
    return [
      "YOU MUST ALWAYS RESPOND IN HINGLISH (natural Hindi-English mix).",
      getInterviewLanguageStyle("hi"),
      "Conduct the whole interview in this Hinglish style — greetings, questions, follow-ups, and farewells.",
      HINDI_QUESTION_RULE,
    ].join(" ");
  }
  const name = INTERVIEW_LANGUAGE_DISPLAY[key];
  return `YOU MUST ALWAYS RESPOND IN ${name}. You must conduct this interview entirely in ${name}. Do not switch to any other language under any circumstance.`;
}

/** Content-generation / report language instruction (questions, summaries, etc.). */
export function interviewLanguageContentInstruction(
  language?: string | null,
): string {
  const key = resolveInterviewLanguage(language);
  if (key === "en") return "";
  if (key === "hi") {
    return [
      `Write ALL user-facing text in Hinglish (${INTERVIEW_LANGUAGE_DISPLAY.hi}).`,
      getInterviewLanguageStyle("hi"),
      "Mixing Hindi and English on purpose is required — do not write pure Hindi or pure English.",
    ].join(" ");
  }
  const name = INTERVIEW_LANGUAGE_DISPLAY[key];
  return `Write ALL user-facing text in ${name}. Do NOT mix languages.`;
}

// ── Interview language setting (English / Hindi / Multi-language) ──────

/** Value stored on interviews.language for "Multi-language (Hindi + English)". */
export const MULTI_LANGUAGE = "multi";

/** Options shown when creating or editing an interview. */
export const INTERVIEW_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: MULTI_LANGUAGE, label: "Multi-language (Hindi + English)" },
] as const;

/** A language a candidate can pick or switch to in a multi-language interview. */
export type CandidateLanguage = "en" | "hi";

export function isMultiLanguage(language?: string | null): boolean {
  return !!language && language.trim().toLowerCase() === MULTI_LANGUAGE;
}

/** "en" | "hi" from a stored / sent value, or null when it isn't one of them. */
export function normalizeCandidateLanguage(value?: string | null): CandidateLanguage | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "en" || v.startsWith("en-") || v === "english") return "en";
  if (v === "hi" || v.startsWith("hi-") || v === "hindi" || v === "hinglish") return "hi";
  return null;
}

/** The language a session actually runs in (multi → the candidate's choice, default English). */
export function sessionInterviewLanguage(interviewLanguage?: string | null, sessionLanguage?: string | null): string {
  if (isMultiLanguage(interviewLanguage)) return normalizeCandidateLanguage(sessionLanguage) ?? "en";
  return interviewLanguage || "en";
}

/** Hindi is (or may be) spoken: transcripts must be stored in Roman-script Hinglish. */
export function involvesHindi(interviewLanguage?: string | null, sessionLanguage?: string | null): boolean {
  return isMultiLanguage(interviewLanguage) || resolveInterviewLanguage(sessionInterviewLanguage(interviewLanguage, sessionLanguage)) === "hi";
}

/** Plain label for panels and reports ("Hindi", "Multi-language (Hindi + English) — Hindi chosen"). */
export function interviewLanguageLabel(interviewLanguage?: string | null, sessionLanguage?: string | null): string {
  if (isMultiLanguage(interviewLanguage)) {
    const chosen = normalizeCandidateLanguage(sessionLanguage);
    return chosen ? `Multi-language (Hindi + English), ${chosen === "hi" ? "Hindi" : "English"} chosen` : "Multi-language (Hindi + English)";
  }
  const key = resolveInterviewLanguage(interviewLanguage);
  if (key === "en") return "English";
  if (key === "hi") return "Hindi";
  return INTERVIEW_LANGUAGE_DISPLAY[key];
}

/**
 * Value for the settings dropdown. Older interviews may use zh / es / fr:
 * keep them selectable so saving the form doesn't silently change them.
 */
export function interviewLanguageSelectOptions(current?: string | null): Array<{ value: string; label: string }> {
  const base: Array<{ value: string; label: string }> = INTERVIEW_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const value = normalizeInterviewLanguageSetting(current);
  if (!base.some((o) => o.value === value)) base.push({ value, label: INTERVIEW_LANGUAGE_DISPLAY[value as InterviewLanguage] ?? value });
  return base;
}

/** Stored setting value: "multi" stays, anything else becomes its language code. */
export function normalizeInterviewLanguageSetting(language?: string | null): string {
  return isMultiLanguage(language) ? MULTI_LANGUAGE : resolveInterviewLanguage(language);
}

/**
 * Prompt rules for a multi-language interview. `current` is the language the
 * candidate chose or last switched to.
 */
export function multiLanguageRequirement(current: CandidateLanguage): string {
  const now = current === "hi"
    ? "The participant currently prefers HINDI: speak Hinglish (natural Hindi-English mix, technical terms in English)."
    : "The participant currently prefers ENGLISH: speak clear, natural English.";
  return [
    "This interview supports Hindi and English. The participant may speak Hindi, English, or mix both freely; understand all of it and never correct their language.",
    now,
    "If the participant switches language or asks to (\"Hindi mein baat karte hain\", \"can we speak English\"), switch at once: say one short line in the new language and continue the current question in it.",
    "When they mix languages, reply in the language they mostly used.",
    "Ask each scripted question in the current language: translate it naturally, keep its meaning and technical terms. Do not add or drop content.",
    "Never call any function to switch language.",
  ].join(" ");
}

/** Extra rule for Hindi interviews whose question list is written in English. */
export const HINDI_QUESTION_RULE =
  "The question list may be written in English: ask each question in Hinglish, translated naturally with the same meaning and English technical terms. Do not add or drop content.";

const SWITCH_TO_HI = [
  /\bhindi\s+(m(e|ei|ai)n?|me)\b/i,
  /\b(speak|talk|continue|switch)\b[^.?!]{0,20}\bhindi\b/i,
  /\bhindi\b[^.?!]{0,12}\b(please|chalega|karein|karte|bolo|boliye|baat)\b/i,
  /हिंदी\s*में|हिन्दी\s*में/,
];
const SWITCH_TO_EN = [
  /\benglish\s+(m(e|ei|ai)n?|me)\b/i,
  /\b(speak|talk|continue|switch)\b[^.?!]{0,20}\benglish\b/i,
  /\benglish\b[^.?!]{0,12}\b(please|chalega|karein|karte|bolo|boliye|baat)\b/i,
  /इंग्लिश\s*में|अंग्रेज़?ी\s*में/,
];

/**
 * The candidate asked to change language ("Hindi mein baat karte hain",
 * "can we speak English"). Returns the new language or null.
 */
export function detectLanguageSwitch(text?: string | null): CandidateLanguage | null {
  if (!text) return null;
  const hi = SWITCH_TO_HI.some((re) => re.test(text));
  const en = SWITCH_TO_EN.some((re) => re.test(text));
  if (hi === en) return null; // none, or both mentioned (ambiguous)
  return hi ? "hi" : "en";
}
