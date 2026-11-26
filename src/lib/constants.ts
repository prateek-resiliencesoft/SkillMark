import { INTERVIEW_LANGUAGE_OPTIONS } from "@/lib/interview-language";

/** Interview language: English, Hindi, or Multi-language (Hindi + English). */
export const LANGUAGES = INTERVIEW_LANGUAGE_OPTIONS;

export const AI_TONES = [
  { value: "CASUAL", label: "Casual" },
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "FORMAL", label: "Formal" },
  { value: "FRIENDLY", label: "Friendly" },
] as const;

export const FOLLOW_UP_DEPTHS = [
  { value: "LIGHT", label: "Light", description: "no follow-up" },
  { value: "MODERATE", label: "Moderate", description: "1-2 follow-ups" },
  { value: "DEEP", label: "Deep", description: "3-5 follow-ups" },
] as const;
