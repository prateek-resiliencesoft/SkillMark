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

export class AiRateLimitError extends Error {
  constructor(message: string, public daily = false) {
    super(message);
    this.name = "AiRateLimitError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errStatus(err: unknown): number | undefined {
  const e = err as { status?: number; message?: string };
  if (typeof e?.status === "number") return e.status;
  const m = e?.message?.match(/\b(429|503)\b/);
  return m ? Number(m[1]) : undefined;
}

function retryAfterMs(err: unknown): number | null {
  const h = (err as { headers?: Record<string, string> | Headers })?.headers;
  const v = h ? (typeof (h as Headers).get === "function" ? (h as Headers).get("retry-after") : (h as Record<string, string>)["retry-after"]) : null;
  if (!v) return null;
  const n = Number(v);
  if (!Number.isNaN(n)) return n * 1000;
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}

function isDailyQuota(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? "";
  return /per day|PerDay|retry in \d+h/i.test(msg);
}

/**
 * Gemini's OpenAI-compatible endpoint returns 429 without a parseable body, so we can't
 * tell per-minute from per-day quota. Probe the native API once (a rejected request
 * doesn't consume quota) and read the QuotaFailure details.
 */
async function probeGeminiDailyQuota(provider: LLMProvider, model?: string): Promise<{ daily: boolean; retryMs: number | null }> {
  try {
    const apiKey = (provider as unknown as { client?: { apiKey?: string } }).client?.apiKey;
    if (!apiKey) return { daily: false, retryMs: null };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || provider.defaultModel)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ok" }] }], generationConfig: { maxOutputTokens: 1 } }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.status !== 429) return { daily: false, retryMs: null };
    const body = await res.text();
    const daily = /PerDay|per day/i.test(body);
    const m = body.match(/retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
    const retryMs = m ? ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000 : null;
    log.warn(`Gemini quota probe: ${daily ? "DAILY" : "per-minute"} limit${retryMs ? `, resets in ~${Math.round(retryMs / 60000)} min` : ""}`);
    return { daily, retryMs };
  } catch {
    return { daily: false, retryMs: null };
  }
}

export type StatusFn = (msg: string) => void;

const BACKOFF = [2000, 5000, 10000];

/** generateResponse with 429/503 backoff (+jitter, honours Retry-After). Throws AiRateLimitError when exhausted. */
async function generateWithBackoff(
  provider: LLMProvider,
  params: Parameters<LLMProvider["generateResponse"]>[0],
  onStatus?: StatusFn,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.generateResponse(params);
    } catch (err) {
      const status = errStatus(err);
      if (status !== 429 && status !== 503) throw err;
      if (isDailyQuota(err)) throw new AiRateLimitError("daily quota exhausted", true);
      if (attempt === 0 && status === 429 && provider.id === "gemini") {
        const probe = await probeGeminiDailyQuota(provider, params.model);
        if (probe.daily) throw new AiRateLimitError("daily quota exhausted", true);
        if (probe.retryMs != null && probe.retryMs > 30_000) throw new AiRateLimitError(`${provider.name} rate limit (429)`);
      }
      if (attempt >= BACKOFF.length) throw new AiRateLimitError(`${provider.name} rate limit (${status})`);
      const ra = retryAfterMs(err);
      if (ra != null && ra > 30_000) throw new AiRateLimitError(`${provider.name} rate limit (${status})`, ra > 3_600_000);
      const wait = Math.min(30_000, ra ?? BACKOFF[attempt]) + Math.floor(Math.random() * 750);
      log.warn(`${provider.name} returned ${status}; retry ${attempt + 1}/${BACKOFF.length} in ${wait}ms`);
      onStatus?.(`AI rate limit reached — waiting ${Math.round(wait / 1000)}s and retrying…`);
      await sleep(wait);
    }
  }
}

async function callOnce(
  provider: LLMProvider,
  model: string | undefined,
  content: string,
  jsonMode: boolean,
  onStatus?: StatusFn,
) {
  const base = { messages: [{ role: "user" as const, content }], model, temperature: 0.1, maxTokens: 8192 };
  try {
    // Thinking models (Gemini 3.x) spend output budget on reasoning; 1024 truncated the JSON.
    return await generateWithBackoff(provider, { ...base, jsonMode }, onStatus);
  } catch (err) {
    if (!jsonMode || err instanceof AiRateLimitError || errStatus(err) === 429) throw err;
    // Some OpenAI-compatible providers reject response_format — retry plain.
    log.warn("JSON mode request failed, retrying without it", err instanceof Error ? err.message : err);
    return generateWithBackoff(provider, base, onStatus);
  }
}

export const QUOTA_MESSAGE = "AI quota exhausted; try again in a minute or check your Gemini plan (Settings → AI).";

/** Parse resume text into structured JSON. Retries once with a stricter prompt (not after rate limits). Throws on failure. */
export async function parseResumeText(
  provider: LLMProvider,
  model: string | undefined,
  resumeText: string,
  opts: { onStatus?: StatusFn; fallbacks?: { provider: LLMProvider; model: string }[] } = {},
): Promise<Record<string, unknown>> {
  const text = resumeText.slice(0, 30_000);
  const attempts = [
    `${RESUME_PARSE_PROMPT}\n\nResume text:\n"""\n${text}\n"""`,
    `Return ONE valid minified JSON object and nothing else — no prose, no markdown, no trailing commas. Keep "notes" under 200 characters and "skills" to at most 12 items.\n\n${RESUME_PARSE_PROMPT}\n\nResume text:\n"""\n${text}\n"""`,
  ];
  const chain = [{ provider, model }, ...(opts.fallbacks ?? [])];
  let lastErr = "AI response was not valid JSON";
  let rateLimited: AiRateLimitError | null = null;
  for (let c = 0; c < chain.length; c++) {
    const { provider: p, model: m } = chain[c];
    if (c > 0) opts.onStatus?.(`Primary AI is rate-limited — trying ${p.name}…`);
    try {
      for (let i = 0; i < attempts.length; i++) {
        const res = await callOnce(p, m, attempts[i], true, opts.onStatus);
        const parsed = parseLooseJsonObject(res.content ?? "");
        if (parsed) return parsed;
        lastErr = `AI response was not valid JSON (finish: ${res.finishReason}, ${res.content?.length ?? 0} chars)`;
        log.warn(`Resume parse attempt ${i + 1} failed: ${lastErr}. Raw snippet: ${(res.content ?? "").slice(0, 300).replace(/\s+/g, " ")}`);
      }
      throw new Error(lastErr);
    } catch (err) {
      if (err instanceof AiRateLimitError) {
        rateLimited = err;
        log.warn(`${p.name}: ${err.message}`);
        continue; // next provider, skip the stricter-prompt call
      }
      throw err;
    }
  }
  if (rateLimited) {
    throw new AiRateLimitError(
      rateLimited.daily
        ? "AI daily quota exhausted for this key (free tier). Try again tomorrow, or add a paid Gemini key / another AI provider in Settings → AI."
        : QUOTA_MESSAGE,
      rateLimited.daily,
    );
  }
  throw new Error(lastErr);
}
