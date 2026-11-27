import {
  interviewLanguageContentInstruction,
  resolveInterviewLanguage,
} from "@/lib/interview-language";
import { isIntroQuestion, standardIntroText } from "@/lib/question-order";
import type { LLMMessage } from "../types";

export interface PremadeQuestionInput {
  text: string;
  type?: string;
  sectionName?: string;
  description?: string;
  options?: unknown;
  starterCode?: unknown;
  skipIf?: { answerContainsAny?: string[]; reason?: string } | null;
}

/** How a CODING question is written (shared with round 2's AI coding task). */
export const CODING_QUESTION_RULE =
  'For CODING questions, set "options" to null. Write a clear problem statement in the question text. Include a "starterCode" object with "language" and "code" fields containing a code template for the participant.';

function generatorLanguageBlock(language?: string): string {
  if (!language || resolveInterviewLanguage(language) === "en") return "";
  const content = interviewLanguageContentInstruction(language);
  return `\nLANGUAGE: ${content} Applies to title, description, objective, assessment criteria names & descriptions, question texts & descriptions, and follow-up prompts. Only the JSON keys and enum values (e.g. "OPEN_ENDED", "PROFESSIONAL") should remain in English. recommendedSettings.aiGender must be "FEMALE" or "MALE". recommendedSettings.aiName must be the matching persona name: "Sarah" for FEMALE, "Alex" for MALE. Never use "Aural" or the product name as the interviewer name.\n`;
}

function introInstruction(language?: string, premadeQuestions?: PremadeQuestionInput[]): string {
  const hasIntro = (premadeQuestions ?? []).some((q) => isIntroQuestion(q.text));
  const sample = standardIntroText(language);
  if (hasIntro) {
    return `\nINTRO QUESTION:
- The premade / question-bank list already includes an introduction / "tell me about yourself" question. Keep that exact wording and put it first.
- Do NOT add another intro among the complementary questions. Complementary questions are technical / role questions only and must meet the requested count on their own.\n`;
  }
  return `\nINTRO QUESTION (MANDATORY, IN ADDITION TO THE TECHNICAL COUNT):
- The premade list has no introduction question (or there are no premade questions). Add exactly one intro as the FIRST question, written in the interview language.
- Suggested wording: "${sample}"
- This intro is extra: it must not replace or count as one of the complementary / technical questions. Still generate the full set of 5-15 role questions after it.
- Do not add a second intro later in the set.\n`;
}

export function buildGeneratorPrompt(
  description: string,
  durationMinutes?: number,
  language?: string,
  jobDescription?: string,
  resumeText?: string,
  premadeQuestions?: PremadeQuestionInput[],
): LLMMessage[] {
  const languageInstruction = generatorLanguageBlock(language);

  const contextInstruction = (jobDescription || resumeText)
    ? `\nCONTEXT DOCUMENTS:
${jobDescription ? "- A JOB DESCRIPTION has been provided. Tailor questions to assess the specific skills, qualifications, and responsibilities listed in the JD. Derive assessment criteria from the role requirements." : ""}
${resumeText ? "- A CANDIDATE RESUME has been provided. Include questions that probe the candidate's claimed experience, validate key skills, and explore any gaps or transitions in their background." : ""}
${jobDescription && resumeText ? "- When both are provided, focus on the intersection: how well the candidate's experience maps to the role requirements, and probe areas where there may be gaps." : ""}
`
    : "";

  const premadeInstruction = (premadeQuestions && premadeQuestions.length > 0)
    ? `\nPREMADE STANDARDIZED QUESTIONS (MANDATORY) — EXACT WORDING:
The recruiter has designated the following pre-approved standard questions. Copy each "text" field CHARACTER-FOR-CHARACTER into your output. Do NOT paraphrase, shorten, expand, translate, or polish them.
${premadeQuestions.map((q, idx) => `${idx + 1}. [Round: ${q.sectionName || "General"}] (${q.type || "OPEN_ENDED"}): "${q.text}"${q.description ? ` (Description: ${q.description})` : ""}${(q as { skipIf?: { reason?: string; answerContainsAny?: string[] } }).skipIf?.answerContainsAny?.length ? ` [skipIf answered about: ${(q as { skipIf: { answerContainsAny: string[] } }).skipIf.answerContainsAny.join(", ")}]` : ""}`).join("\n")}

CRITICAL INSTRUCTIONS FOR PREMADE QUESTIONS:
- Include EVERY premade question with the EXACT same "text" string (byte-identical to the quotes above).
- Keep their question type. Copy description/options/starterCode/skipIf as given (including skipIf.answerContainsAny keywords).
- DO NOT duplicate or invent a reworded twin of any premade question.
- Generate additional COMPLEMENTARY questions for areas not already covered by the premade list.
- Arrange in logical progression: warm-up/screening → technical → behavioral/HR, keeping premade texts untouched.\n`
    : "";

  return [
    {
      role: "system",
      content: `You are an expert interview designer. Create a comprehensive interview structure based on the user's requirements.
${languageInstruction}${contextInstruction}${premadeInstruction}${introInstruction(language, premadeQuestions)}
TASK:
Design a complete interview with:
1. A compelling title
2. A brief description (1-2 sentences summarizing the interview purpose)
3. Clear objective statement
4. 3-6 specific, measurable assessment criteria based on the interview objective
5. 5-15 well-crafted questions in logical flow
6. Recommended question types for each
7. Optimal AI persona configuration

GUIDELINES:
- Start with the intro question (see INTRO QUESTION rules). The intro is never scored
- Group related topics together
- Place most important questions in the middle (when engagement is highest)
- End with an open "anything else" question
- Use OPEN_ENDED for free-text/verbal responses, SINGLE_CHOICE when the participant must pick exactly one option, MULTIPLE_CHOICE when multiple selections are allowed, CODING for programming/algorithm questions, and RESEARCH when the goal is to extract as much detailed information as possible on a topic
- For SINGLE_CHOICE and MULTIPLE_CHOICE questions, ALWAYS provide 2-6 clear option strings in the "options" field
- ${CODING_QUESTION_RULE}
- Suggest time limits where appropriate
- Assessment criteria should be specific dimensions the participant will be evaluated on (e.g. "Communication Skills", "Problem Solving Ability", "Cultural Fit")
- recommendedSettings.aiGender must be "FEMALE" or "MALE" (default FEMALE). recommendedSettings.aiName must be "Sarah" when FEMALE and "Alex" when MALE. Never use "Aural" or the product name as the interviewer name.

QUESTION TYPES:
- "OPEN_ENDED": Free-form text or verbal response. Set "options" to null.
- "SINGLE_CHOICE": Participant picks exactly one option. MUST include "options" with 2-6 option strings.
- "MULTIPLE_CHOICE": Participant can select more than one option. MUST include "options" with 2-6 option strings.
- "CODING": A coding/programming question where the participant writes code using a built-in code editor. Set "options" to null. The question text should clearly describe the problem to solve.
- "RESEARCH": A deep-dive question designed to extract comprehensive information on a topic. The interviewer will apply deeper follow-ups to explore every angle. Set "options" to null. Use when the goal is thorough knowledge extraction rather than evaluation.

OUTPUT VALID JSON ONLY (no markdown, no explanation):
{
  "title": "string",
  "description": "string (1-2 sentence summary of the interview purpose)",
  "objective": "string",
  "jobRole": "string (short hiring role title only, e.g. Flutter Developer, HR Business Partner, MERN Stack Developer — not a sentence)",
  "assessmentCriteria": [
    { "name": "string (criterion name)", "description": "string (what this criterion measures)" }
  ],
  "estimatedDurationMinutes": number,
  "questions": [
    {
      "order": number,
      "text": "string",
      "type": "OPEN_ENDED" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "CODING" | "WHITEBOARD" | "RESEARCH",
      "description": "string (helper text for the question)",
      "timeLimitSeconds": number | null,
      "isRequired": true,
      "options": { "options": ["string", "string", ...], "allowMultiple": false } | null,
      "followUpPrompts": ["string"],
      "starterCode": { "language": "string", "code": "string" } | null,
      "skipIf": { "answerContainsAny": ["string"], "reason": "string" } | null
    }
  ],
  "recommendedSettings": {
    "mode": "CHAT" | "VOICE" | "HYBRID",
    "followUpDepth": "LIGHT" | "MODERATE" | "DEEP",
    "aiTone": "CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY",
    "aiGender": "FEMALE" | "MALE",
    "aiName": "Sarah" | "Alex"
  }
}`,
    },
    {
      role: "user",
      content: `Create an interview for the following goal:

"${description}"

${durationMinutes ? `Target duration: approximately ${durationMinutes} minutes.` : ""}
${jobDescription ? `\n--- JOB DESCRIPTION ---\n${jobDescription}\n--- END JOB DESCRIPTION ---\n` : ""}
${resumeText ? `\n--- CANDIDATE RESUME ---\n${resumeText}\n--- END CANDIDATE RESUME ---\n` : ""}
Please generate the complete interview structure as JSON.`,
    },
  ];
}

export function buildImprovePrompt(
  currentInterview: {
    title: string;
    description?: string | null;
    objective?: string | null;
    jobRole?: string | null;
    assessmentCriteria?: { name: string; description: string }[];
    questions: { text: string; type: string }[];
  },
  feedback: string,
  language?: string,
  jobDescription?: string,
  resumeText?: string,
): LLMMessage[] {
  const questionsText = currentInterview.questions
    .map((q, i) => `${i + 1}. [${q.type}] ${q.text}`)
    .join("\n");

  const criteriaText = currentInterview.assessmentCriteria?.length
    ? currentInterview.assessmentCriteria
        .map((c) => `- ${c.name}: ${c.description}`)
        .join("\n")
    : "None defined";

  return [
    {
      role: "system",
      content: `You are an expert interview designer. Improve an existing interview based on user feedback.
${generatorLanguageBlock(language)}${introInstruction(language, currentInterview.questions)}
Keep exactly one introduction / "tell me about yourself" question as the first question after any rewrite. If the current set has none, add one in the interview language (suggested: "${standardIntroText(language)}"). Do not add a second intro. The intro is never scored and does not count as a technical / role question.
recommendedSettings.aiGender must be "FEMALE" or "MALE" (default FEMALE). recommendedSettings.aiName must be "Sarah" when FEMALE and "Alex" when MALE. Never use "Aural" or the product name as the interviewer name.

REFINEMENT PRIORITY (highest → lowest):
1. USER FEEDBACK — mandatory. Treat it as the recruiter's directive for this rewrite.
2. Attached JD / CV — use only where they support the feedback.
3. Current questions / title / criteria — starting point only; rewrite or drop anything that conflicts with feedback.

When feedback changes the role or domain (e.g. HR / hiring process / people management / leadership instead of engineering):
- Rewrite title, description, objective, and assessment criteria for that role.
- REPLACE the question set so it assesses that domain (e.g. hiring process, sourcing, screening, interviewing, offer/negotiation, onboarding, employee relations, performance management, stakeholder management).
- Do NOT keep coding, algorithms, system-design, or other technical questions unless the feedback explicitly asks for them.
- Prefer OPEN_ENDED and RESEARCH; use CHOICE sparingly; use CODING only if the refined role needs it.

QUESTION TYPES:
- "OPEN_ENDED": Free-form text or verbal response. Set "options" to null.
- "SINGLE_CHOICE": Participant picks exactly one option. MUST include "options" with 2-6 option strings.
- "MULTIPLE_CHOICE": Participant can select more than one option. MUST include "options" with 2-6 option strings.
- "CODING": A coding/programming question where the participant writes code. Set "options" to null.
- "RESEARCH": A deep-dive question for extracting comprehensive information on a topic. Set "options" to null.

OUTPUT VALID JSON ONLY (no markdown, no explanation):
{
  "title": "string",
  "description": "string (1-2 sentence summary of the interview purpose)",
  "objective": "string",
  "jobRole": "string (short hiring role title only, e.g. Flutter Developer, HR Business Partner, MERN Stack Developer — not a sentence)",
  "assessmentCriteria": [
    { "name": "string (criterion name)", "description": "string (what this criterion measures)" }
  ],
  "estimatedDurationMinutes": number,
  "questions": [
    {
      "order": number,
      "text": "string",
      "type": "OPEN_ENDED" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "CODING" | "WHITEBOARD" | "RESEARCH",
      "description": "string (helper text for the question)",
      "timeLimitSeconds": number | null,
      "isRequired": true,
      "options": { "options": ["string", "string", ...], "allowMultiple": false } | null,
      "followUpPrompts": ["string"],
      "starterCode": { "language": "string", "code": "string" } | null
    }
  ],
  "recommendedSettings": {
    "mode": "CHAT" | "VOICE" | "HYBRID",
    "followUpDepth": "LIGHT" | "MODERATE" | "DEEP",
    "aiTone": "CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY",
    "aiGender": "FEMALE" | "MALE",
    "aiName": "Sarah" | "Alex"
  }
}

IMPORTANT: Each question MUST have a "text" field with the question content.
IMPORTANT: Always include 3-6 assessment criteria.
IMPORTANT: Always include a "description" field with a 1-2 sentence summary.
IMPORTANT: For SINGLE_CHOICE and MULTIPLE_CHOICE questions, ALWAYS include "options" with 2-6 clear choices.`,
    },
    {
      role: "user",
      content: `Current interview (starting point — rewrite freely if feedback requires it):
Title: ${currentInterview.title}
Description: ${currentInterview.description ?? "Not set"}
Objective: ${currentInterview.objective ?? "Not set"}
Job role: ${currentInterview.jobRole ?? "Not set"}
Assessment Criteria:
${criteriaText}
Questions:
${questionsText}

${jobDescription ? `\n--- JOB DESCRIPTION ---\n${jobDescription}\n--- END JOB DESCRIPTION ---\n` : ""}
${resumeText ? `\n--- CANDIDATE RESUME ---\n${resumeText}\n--- END CANDIDATE RESUME ---\n` : ""}
USER FEEDBACK (mandatory — honor this over the current set and over JD/CV when they conflict):
"${feedback}"

Apply the feedback fully. Output ONLY valid JSON.`,
    },
  ];
}
