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
  const key = resolveInterviewLanguage(language);
  if (key === "zh") {
    return "你必须始终用中文进行面试。你必须用中文回答。不要使用其他语言。";
  }
  if (key === "hi") {
    return [
      "YOU MUST ALWAYS RESPOND IN HINGLISH (natural Hindi-English mix).",
      getInterviewLanguageStyle("hi"),
      "Conduct the whole interview in this Hinglish style — greetings, questions, follow-ups, and farewells.",
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
