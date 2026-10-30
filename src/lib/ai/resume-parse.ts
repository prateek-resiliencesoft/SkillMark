import { createLogger } from "@/lib/logger";
import type { LLMProvider } from "./types";

const log = createLogger("ai/resume-parse");

export const RESUME_PARSE_PROMPT = `You are an expert resume parser. Extract candidate information from the resume and return a JSON object with these fields (use null for missing fields):

{
  "name": "Full name",
  "email": "Email address",
  "phone": "Phone number including country code if present",
  "gender": "Male" | "Female" | "Other" | null,
  "birthday": "YYYY-MM format" | null,
  "education": "College" | "Bachelor" | "Master" | "PhD" | "MBA" | "Other" | null,
  "school": "Most recent school name",
  "major": "Field of study",
  "graduationYear": number | null,
  "workExperience": "Less than one year" | "1 - 3 years" | "3 - 5 years" | "5 - 10 years" | "More than 10 years" | null,
  "notes": "Brief summary of key skills and experience (1-2 sentences)",
  "skills": ["up to 12 short skill names, most prominent first, e.g. React, PostgreSQL"]
}

Rules:
- For workExperience, estimate from the resume dates
- For education, map the highest degree to one of the exact options listed
- Extract ALL contact info including email and phone carefully
- Return ONLY the JSON object, no markdown fences, no explanation`;

/** Tolerant JSON extraction: strips think blocks/fences, takes first balanced {...}, fixes trailing commas & smart quotes. */
export function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1];
  text = text.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  // first balanced object (string-aware)
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null; // truncated
  const candidate = text.slice(start, end + 1);
  for (const s of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

async function callOnce(provider: LLMProvider, model: string | undefined, content: string, jsonMode: boolean) {
  try {
    return await provider.generateResponse({
      messages: [{ role: "user", content }],
      model,
      temperature: 0.1,
      // Thinking models (Gemini 3.x) spend output budget on reasoning; 1024 truncated the JSON.
      maxTokens: 8192,
      jsonMode,
    });
  } catch (err) {
    if (!jsonMode) throw err;
    // Some OpenAI-compatible providers reject response_format — retry plain.
    log.warn("JSON mode request failed, retrying without it", err instanceof Error ? err.message : err);
    return provider.generateResponse({ messages: [{ role: "user", content }], model, temperature: 0.1, maxTokens: 8192 });
  }
}

/** Parse resume text into structured JSON. Retries once with a stricter prompt. Throws on failure. */
export async function parseResumeText(
  provider: LLMProvider,
  model: string | undefined,
  resumeText: string,
): Promise<Record<string, unknown>> {
  const text = resumeText.slice(0, 30_000);
  const attempts = [
    `${RESUME_PARSE_PROMPT}\n\nResume text:\n"""\n${text}\n"""`,
    `Return ONE valid minified JSON object and nothing else — no prose, no markdown, no trailing commas. Keep "notes" under 200 characters and "skills" to at most 12 items.\n\n${RESUME_PARSE_PROMPT}\n\nResume text:\n"""\n${text}\n"""`,
  ];
  let lastErr = "AI response was not valid JSON";
  for (let i = 0; i < attempts.length; i++) {
    const res = await callOnce(provider, model, attempts[i], true);
    const parsed = parseLooseJsonObject(res.content ?? "");
    if (parsed) return parsed;
    lastErr = `AI response was not valid JSON (finish: ${res.finishReason}, ${res.content?.length ?? 0} chars)`;
    log.warn(`Resume parse attempt ${i + 1} failed: ${lastErr}. Raw snippet: ${(res.content ?? "").slice(0, 300).replace(/\s+/g, " ")}`);
  }
  throw new Error(lastErr);
}
