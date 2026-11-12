/**
 * Single place for interviewer gender, display names, and provider voices.
 * Per-interview aiGender overrides the org default. Default is Female.
 */
export const INTERVIEWER_GENDERS = ["FEMALE", "MALE"] as const;
export type InterviewerGender = (typeof INTERVIEWER_GENDERS)[number];

export interface InterviewerPersona {
  gender: InterviewerGender;
  /** Spoken first name used in greetings and the system prompt. */
  name: string;
  /** How to describe the interviewer in prompts (English). */
  promptGender: "female" | "male";
  /** Chinese wording for the same. */
  promptGenderZh: "女" | "男";
  /** Gemini Live prebuilt voice. */
  geminiVoice: string;
  /** OpenAI Realtime / Azure OpenAI voice. */
  openAiVoice: string;
}

export const INTERVIEWER_PERSONAS: Record<InterviewerGender, InterviewerPersona> = {
  FEMALE: {
    gender: "FEMALE",
    name: "Sarah",
    promptGender: "female",
    promptGenderZh: "女",
    geminiVoice: "Kore",
    openAiVoice: "coral",
  },
  MALE: {
    gender: "MALE",
    name: "Alex",
    promptGender: "male",
    promptGenderZh: "男",
    // Charon is Google's "informative" male prebuilt — clear and professional.
    geminiVoice: "Charon",
    openAiVoice: "echo",
  },
};

/** Names / product leftovers that should follow the selected gender. */
const DEFAULT_NAME_SET = new Set(
  [
    ...Object.values(INTERVIEWER_PERSONAS).map((p) => p.name),
    "ResilienceSoft Interview",
    "ResilienceSoft",
    "Resiliencesoft Interview",
    "Resiliencesoft Interview AI",
    "Aural",
    "Aural AI",
    "Aural Interviewer",
  ].map((s) => s.toLowerCase()),
);

export function normalizeInterviewerGender(
  value: string | null | undefined,
): InterviewerGender {
  return String(value || "").toUpperCase() === "MALE" ? "MALE" : "FEMALE";
}

export function getInterviewerPersona(
  gender: string | null | undefined,
): InterviewerPersona {
  return INTERVIEWER_PERSONAS[normalizeInterviewerGender(gender)];
}

export function isDefaultInterviewerName(name: string | null | undefined): boolean {
  return DEFAULT_NAME_SET.has(String(name || "").trim().toLowerCase());
}

/**
 * Pick the spoken name: keep a custom name, otherwise use the persona name
 * for the chosen gender (so a female interviewer is never introduced as Alex).
 */
export function resolveInterviewerName(
  storedName: string | null | undefined,
  gender: string | null | undefined,
): string {
  const persona = getInterviewerPersona(gender);
  const trimmed = String(storedName || "").trim();
  if (!trimmed || isDefaultInterviewerName(trimmed)) return persona.name;
  return trimmed;
}

/** Gemini Live voice for this gender. Env override applies only as the Female fallback. */
export function resolveGeminiVoice(gender: string | null | undefined): string {
  const g = normalizeInterviewerGender(gender);
  if (g === "MALE") return INTERVIEWER_PERSONAS.MALE.geminiVoice;
  const env = process.env.GEMINI_LIVE_VOICE?.trim();
  return env || INTERVIEWER_PERSONAS.FEMALE.geminiVoice;
}

/** OpenAI / Azure voice. AZURE_OPENAI_VOICE applies only as the Female fallback. */
export function resolveOpenAiVoice(gender: string | null | undefined): string {
  const g = normalizeInterviewerGender(gender);
  if (g === "MALE") return INTERVIEWER_PERSONAS.MALE.openAiVoice;
  const env = process.env.AZURE_OPENAI_VOICE?.trim();
  return (env || INTERVIEWER_PERSONAS.FEMALE.openAiVoice).toLowerCase();
}

export function interviewerPromptIdentity(
  storedName: string | null | undefined,
  gender: string | null | undefined,
  tone: string | null | undefined,
  lang: "en" | "zh" = "en",
): { name: string; gender: InterviewerGender; line: string } {
  const persona = getInterviewerPersona(gender);
  const name = resolveInterviewerName(storedName, gender);
  const toneBit = (tone || "professional").toLowerCase();
  const line =
    lang === "zh"
      ? `你是"${name}"，一位${toneBit}的${persona.promptGenderZh}性AI面试官。请始终以"${name}"这个名字和${persona.promptGenderZh}性身份自称，不要使用任何其他名字或改变性别。`
      : `You are "${name}", a ${toneBit} ${persona.promptGender} AI interviewer. Always introduce yourself as ${name} and stay consistent with this ${persona.promptGender} persona. Never use a different name or gender.`;
  return { name, gender: persona.gender, line };
}

export const INTERVIEWER_GENDER_OPTIONS: Array<{
  value: InterviewerGender;
  label: string;
  labelZh: string;
}> = [
  { value: "FEMALE", label: "Female", labelZh: "女性" },
  { value: "MALE", label: "Male", labelZh: "男性" },
];
