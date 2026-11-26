/** Live interviewer rules for understanding Indian-English answers (English prompts only). */
export const LISTENING_RULES = `
## Listening Carefully
- Participants often speak Indian English. Understand every answer in the context of the question you just asked: an answer to "what is your name" is a person's name; an answer about salary or CTC is an amount ("5 LPA" means 5 lakhs per annum, never a time like "5 PM"); an answer about notice period is a duration.
- Common terms: LPA, lakh, crore, CTC, in-hand, fixed, variable, notice period, serving notice, B.Tech, M.Tech, MCA.
- When the participant gives their name, a salary / CTC figure, a notice period, or years of experience, repeat it back briefly in your acknowledgement (e.g. "Got it, 5 LPA.") so they can correct you.
- If you did not hear a name or number clearly, ask them to repeat it (or spell a name). Never guess.`;

/** Vocabulary hint for the speech-to-text model (OpenAI transcription `prompt`). */
export const TRANSCRIPTION_HINT =
  "Job interview in Indian English. Indian names. Terms: CTC, LPA, lakhs per annum, lakh, crore, in-hand, fixed, variable, notice period, serving notice, B.Tech, M.Tech, MCA.";

/** Speech-to-text hint for Hindi interviews (Hindi sentences, English technical terms). */
export const TRANSCRIPTION_HINT_HINGLISH =
  "Job interview in Hinglish: Hindi sentences mixed with English technical words. Indian names. Terms: CTC, LPA, lakhs per annum, lakh, crore, in-hand, notice period, serving notice, relocate, B.Tech, M.Tech, MCA, project, experience.";

/**
 * OpenAI realtime `audio.input.transcription` settings for the interview
 * language. Without `language` + a Hindi prompt, Hindi speech was transcribed
 * against an English-only hint (wrong words / translated / made-up text).
 */
export function transcriptionSettings(model: string, interviewLanguage?: string | null): { model: string; prompt: string; language?: string } {
  const l = (interviewLanguage ?? "").trim().toLowerCase();
  if (l === "hi" || l.startsWith("hi-") || l.includes("hindi") || l.includes("hinglish")) {
    return { model, prompt: TRANSCRIPTION_HINT_HINGLISH, language: "hi" };
  }
  if (l === "multi" || l.startsWith("multi")) return { model, prompt: TRANSCRIPTION_HINT_HINGLISH };
  return { model, prompt: TRANSCRIPTION_HINT };
}
