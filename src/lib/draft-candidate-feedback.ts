import { FEEDBACK_COMMENT_MAX } from "@/lib/candidate-feedback";

export const FEEDBACK_ENHANCE_MIN = 20;
export const FEEDBACK_ENHANCE_MAX = FEEDBACK_COMMENT_MAX; // 1000

export function parseEnhanceFeedbackInput(input: { draft?: string }): { draft: string } {
  const draft = (input.draft ?? "").trim().slice(0, FEEDBACK_ENHANCE_MAX);
  if (draft.length < FEEDBACK_ENHANCE_MIN) {
    throw new Error(`Write at least ${FEEDBACK_ENHANCE_MIN} characters before enhancing`);
  }
  return { draft };
}

export function buildEnhanceFeedbackPrompt(draft: string): string {
  return `You polish a candidate's optional feedback about their interview experience.

Rules:
- Output ONLY the finished feedback text. No labels, quotes, markdown, or preamble.
- Keep the candidate's meaning and tone. Do not invent facts, events, people, scores, or complaints they did not mention.
- Clear, natural first-person or neutral experience note. Fix grammar and flow.
- 1–3 COMPLETE sentences that each end with a period (or ? / !). Never stop mid-sentence.
- Target length: roughly the same as the draft; must stay under ${FEEDBACK_ENHANCE_MAX} characters.

Candidate draft to polish:
${draft}`;
}

export function finalizeEnhanceFeedback(raw: string): string {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, FEEDBACK_ENHANCE_MAX);

  if (!text) return "";

  if (!/[.!?]$/.test(text)) {
    const lastStop = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
    if (lastStop >= FEEDBACK_ENHANCE_MIN) {
      text = text.slice(0, lastStop + 1).trim();
    }
  }

  return text.slice(0, FEEDBACK_ENHANCE_MAX);
}

export function fallbackEnhanceFeedback(draft: string): string {
  return finalizeEnhanceFeedback(draft);
}
