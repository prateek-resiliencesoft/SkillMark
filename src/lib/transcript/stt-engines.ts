/**
 * Speech-to-text engines for rebuilding a candidate transcript from a recording.
 *
 * Engines are picked from the keys the org saved in Settings → AI (env keys only
 * as the platform fallback), so each org gets the best engine its own keys allow:
 *
 *   Gemini key → gemini-3.5-transcribe (Hindi + Indian English hints, custom vocabulary),
 *                 falling back to the general Gemini models
 *   OpenAI key → gpt-transcribe (languages + keywords), falling back to gpt-4o-transcribe
 *   Groq key   → whisper-large-v3 (language hint + prompt)
 *   Custom     → any OpenAI-compatible /audio/transcriptions endpoint (platform-configured only)
 *   Anthropic / NVIDIA have no speech-to-text, so they are skipped here.
 *
 * To add an engine (Sarvam, Deepgram, ...): add its id to SttEngineId, implement
 * SttEngine, register it in STT_ENGINES, and add it to DEFAULT_STT_ORDER.
 *
 * Pure apart from `fetch` (injectable for tests).
 */
import type { AiProviderId, AiRoutingStored, ResolvedAiCredentials } from "@/lib/ai/credentials";
import { GEMINI_FALLBACK_MODELS, normalizeGeminiModel } from "@/lib/ai/gemini-models";
import { involvesHindi, resolveInterviewLanguage, sessionInterviewLanguage } from "@/lib/interview-language";

export type SttEngineId = "gemini" | "openai" | "groq" | "custom";

/** One key on one engine: the unit the fallback chain walks. */
export type SttCandidate = {
  engine: SttEngineId;
  apiKey: string;
  baseUrl?: string;
  /** For logs only, never the key itself. */
  label: string;
};

export type SttLanguages = {
  /** BCP-47 hints (Gemini). */
  bcp47: string[];
  /** ISO-639-1 hints (OpenAI `languages`). */
  iso: string[];
  /** Single code (Whisper-style engines); undefined = auto-detect. */
  single?: string;
  hindi: boolean;
};

export type SttClipRequest = {
  audio: Buffer;
  /** audio/wav for clips we cut ourselves. */
  mime: string;
  languages: SttLanguages;
  vocabulary: string[];
  promptHint: string;
};

export type SttDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export class SttHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface SttEngine {
  id: SttEngineId;
  label: string;
  transcribeClip(candidate: SttCandidate, req: SttClipRequest, deps?: SttDeps): Promise<{ text: string; model: string }>;
}

const REQUEST_TIMEOUT_MS = 90_000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Order when the org has not chosen: best Hindi accuracy first. */
export const DEFAULT_STT_ORDER: readonly SttEngineId[] = ["gemini", "openai", "groq", "custom"];

export function isSttEngineId(id: string): id is SttEngineId {
  return (DEFAULT_STT_ORDER as readonly string[]).includes(id);
}

// ── Language mapping ────────────────────────────────────────────────────────

export function sttLanguagesFor(interviewLanguage?: string | null, sessionLanguage?: string | null): SttLanguages {
  if (involvesHindi(interviewLanguage, sessionLanguage)) {
    // Hindi interviews are code-mixed with English (and Indian English), so give both.
    return { bcp47: ["hi-IN", "en-IN"], iso: ["hi", "en"], single: "hi", hindi: true };
  }
  const lang = resolveInterviewLanguage(sessionInterviewLanguage(interviewLanguage, sessionLanguage));
  switch (lang) {
    case "zh":
      return { bcp47: ["zh-CN"], iso: ["zh"], single: "zh", hindi: false };
    case "es":
      return { bcp47: ["es-ES"], iso: ["es"], single: "es", hindi: false };
    case "fr":
      return { bcp47: ["fr-FR"], iso: ["fr"], single: "fr", hindi: false };
    default:
      return { bcp47: ["en-IN"], iso: ["en"], single: "en", hindi: false };
  }
}

// ── Selection ───────────────────────────────────────────────────────────────

export type SttSelectionInput = {
  merged: ResolvedAiCredentials;
  /** The org's saved routing (stored entries only, no defaults). */
  routing: AiRoutingStored;
  /** Max keys tried in one run. */
  maxCandidates?: number;
};

/**
 * Engine order: the org's saved speech-to-text routing, then the provider it
 * ranks first for reports (its primary), then the default order. Only providers
 * that can transcribe and have a key are used.
 */
export function selectSttCandidates(input: SttSelectionInput): SttCandidate[] {
  const { merged, routing } = input;
  const preferred: string[] = [...(routing.round2_transcript ?? []), ...(routing.report ?? []), ...DEFAULT_STT_ORDER];
  const order: SttEngineId[] = [];
  for (const id of preferred) {
    if (isSttEngineId(id) && !order.includes(id)) order.push(id);
  }

  const out: SttCandidate[] = [];
  for (const engine of order) {
    const creds = merged[engine as AiProviderId];
    if (!creds || !creds.apiKeys.length) continue;
    // A tenant-supplied custom base URL is never contacted from the server.
    if (engine === "custom" && (!creds.baseUrl || creds.untrustedBaseUrl)) continue;
    creds.apiKeys.forEach((apiKey, i) => {
      if (!apiKey) return;
      out.push({
        engine,
        apiKey,
        baseUrl: creds.baseUrl?.replace(/\/+$/, ""),
        label: `${engine}/${creds.from}#${i + 1}`,
      });
    });
  }
  return out.slice(0, input.maxCandidates ?? 6);
}

/** Providers the org has a key for that cannot transcribe (for the "why was it skipped" log). */
export function describeNoSttReason(merged: ResolvedAiCredentials): string {
  const have = (Object.keys(merged) as AiProviderId[]).filter((id) => merged[id]?.apiKeys.length);
  if (!have.length) return "No AI key is configured. Add a Gemini, OpenAI or Groq key in Settings → AI.";
  return `None of the configured AI keys (${have.join(", ")}) can transcribe speech. Add a Gemini, OpenAI or Groq key in Settings → AI.`;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

async function postWithRetry(
  deps: SttDeps | undefined,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const doFetch = deps?.fetch ?? fetch;
  const sleep = deps?.sleep ?? defaultSleep;
  let res = await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 429 || res.status === 503) {
    await sleep(4000); // brief overload / per-minute limit
    res = await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }
  return res;
}

async function failIfBad(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.text().catch(() => "")).slice(0, 300);
  throw new SttHttpError(`${what} ${res.status}: ${body}`, res.status);
}

const oneLine = (s: string) => s.replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim();

// ── Gemini ──────────────────────────────────────────────────────────────────

const GEMINI_API = "https://generativelanguage.googleapis.com";
export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

/** Text of an Interactions API response: model-output steps, then the older outputs[] shape. */
export function geminiInteractionText(json: unknown): string {
  const j = json as {
    steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
    outputs?: { type?: string; text?: string }[];
    output_text?: string;
  };
  const parts: string[] = [];
  for (const step of j.steps ?? []) {
    if (step.type && /user|input|thought/i.test(step.type)) continue;
    for (const c of step.content ?? []) if (typeof c.text === "string") parts.push(c.text);
  }
  if (!parts.length) for (const o of j.outputs ?? []) if (typeof o.text === "string") parts.push(o.text);
  if (!parts.length && typeof j.output_text === "string") parts.push(j.output_text);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function generalGeminiModels(): string[] {
  const list = [
    process.env.GEMINI_TRANSCRIBE_MODEL?.trim() ? normalizeGeminiModel(process.env.GEMINI_TRANSCRIBE_MODEL) : null,
    process.env.GEMINI_MODEL?.trim() ? normalizeGeminiModel(process.env.GEMINI_MODEL) : null,
    ...GEMINI_FALLBACK_MODELS,
  ].filter((m): m is string => !!m && m !== GEMINI_TRANSCRIBE_MODEL);
  return Array.from(new Set(list));
}

function generalGeminiPrompt(req: SttClipRequest): string {
  return `Transcribe this short audio clip of a job candidate answering an interview question.
Rules:
- Write exactly what was said, in the order said. Never invent, summarise, translate or fix content.
- ${req.languages.hindi ? "The candidate may speak Hindi, English or a mix (Hinglish). Keep each word in the language it was spoken." : "Keep the language as spoken."}
- Keep amounts and numbers as digits (8.65 LPA, 12 lakhs, 30 days). Indian HR terms stay as spoken: CTC, LPA, lakh, notice period.
- Likely names and terms: ${req.vocabulary.slice(0, 60).map(oneLine).join(", ")}.
- If there is no speech, return an empty string.
Return only the transcript text.`;
}

const geminiEngine: SttEngine = {
  id: "gemini",
  label: "Gemini",
  async transcribeClip(candidate, req, deps) {
    const headers = { "x-goog-api-key": candidate.apiKey, "Content-Type": "application/json" };
    const data = req.audio.toString("base64");
    try {
      const res = await postWithRetry(deps, `${GEMINI_API}/v1beta/interactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: GEMINI_TRANSCRIBE_MODEL,
          input: [{ type: "audio", data, mime_type: req.mime }],
          generation_config: {
            transcription_config: {
              language_codes: req.languages.bcp47,
              custom_vocabulary: req.vocabulary.map(oneLine).filter(Boolean).slice(0, 100),
            },
          },
        }),
      });
      await failIfBad(res, "Gemini transcribe");
      const text = geminiInteractionText(await res.json());
      return { text, model: GEMINI_TRANSCRIBE_MODEL };
    } catch (err) {
      const status = err instanceof SttHttpError ? err.status : 0;
      // A bad or exhausted key won't work on the general models either.
      if (status === 401 || status === 403 || status === 429) throw err;
      // Otherwise (model not available to this key/region, API shape change, network) use the general Gemini path.
    }

    let lastErr: unknown;
    for (const model of generalGeminiModels()) {
      try {
        const res = await postWithRetry(deps, `${GEMINI_API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ inline_data: { mime_type: req.mime, data } }, { text: generalGeminiPrompt(req) }] },
            ],
            generationConfig: { temperature: 0, maxOutputTokens: 4096 },
          }),
        });
        await failIfBad(res, "Gemini");
        const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").replace(/\s+/g, " ").trim();
        return { text, model };
      } catch (err) {
        lastErr = err;
        const status = err instanceof SttHttpError ? err.status : 0;
        if (status === 401 || status === 403 || status === 429) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Gemini transcription failed");
  },
};

// ── OpenAI-compatible (OpenAI, Groq, custom) ────────────────────────────────

type CompatConfig = {
  base: string;
  models: { model: string; style: "gpt-transcribe" | "whisper" }[];
};

function compatConfig(candidate: SttCandidate): CompatConfig {
  if (candidate.engine === "groq") {
    return {
      base: candidate.baseUrl || "https://api.groq.com/openai/v1",
      models: [{ model: "whisper-large-v3", style: "whisper" }],
    };
  }
  if (candidate.engine === "openai") {
    return {
      base: candidate.baseUrl || "https://api.openai.com/v1",
      models: [
        { model: "gpt-transcribe", style: "gpt-transcribe" },
        // Older model for keys / proxies that don't have gpt-transcribe yet (OpenAI retires it 2027-02-26).
        { model: "gpt-4o-transcribe", style: "whisper" },
      ],
    };
  }
  return {
    base: candidate.baseUrl || "",
    models: [{ model: process.env.CUSTOM_STT_MODEL?.trim() || "whisper-1", style: "whisper" }],
  };
}

function extFor(mime: string): string {
  if (/wav/.test(mime)) return "wav";
  if (/mp3|mpeg/.test(mime)) return "mp3";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/ogg/.test(mime)) return "ogg";
  return "webm";
}

function makeCompatEngine(id: "openai" | "groq" | "custom", label: string): SttEngine {
  return {
    id,
    label,
    async transcribeClip(candidate, req, deps) {
      const cfg = compatConfig(candidate);
      if (!cfg.base) throw new SttHttpError(`${label}: no base URL`, 404);
      let lastErr: unknown;
      for (const { model, style } of cfg.models) {
        const form = new FormData();
        form.set("model", model);
        form.set(
          "file",
          new Blob([new Uint8Array(req.audio)], { type: req.mime }),
          `clip.${extFor(req.mime)}`,
        );
        form.set("response_format", "json");
        form.set("temperature", "0");
        if (style === "gpt-transcribe") {
          // `languages` replaces `language` on this model: never send both.
          for (const l of req.languages.iso) form.append("languages[]", l);
          for (const k of req.vocabulary.map(oneLine).filter(Boolean).slice(0, 100)) form.append("keywords[]", k);
          form.set("prompt", req.languages.hindi ? "Job interview answer in Hindi and English (Hinglish)." : "Job interview answer.");
        } else {
          if (req.languages.single) form.set("language", req.languages.single);
          form.set("prompt", req.promptHint.slice(0, 600));
        }
        try {
          const res = await postWithRetry(deps, `${cfg.base}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${candidate.apiKey}` },
            body: form,
          });
          await failIfBad(res, `${label} transcribe`);
          const json = (await res.json()) as { text?: string };
          return { text: String(json.text ?? "").replace(/\s+/g, " ").trim(), model };
        } catch (err) {
          lastErr = err;
          const status = err instanceof SttHttpError ? err.status : 0;
          // Bad key / quota: another model on this key won't help.
          if (status === 401 || status === 403 || status === 429) throw err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(`${label} transcription failed`);
    },
  };
}

export const STT_ENGINES: Record<SttEngineId, SttEngine> = {
  gemini: geminiEngine,
  openai: makeCompatEngine("openai", "OpenAI"),
  groq: makeCompatEngine("groq", "Groq"),
  custom: makeCompatEngine("custom", "Custom"),
};

// ── Dispatcher with fallback ────────────────────────────────────────────────

/** Whisper-style models invent these on silence or noise. */
const HALLUCINATIONS = new Set([
  "thank you", "thanks", "thank you for watching", "thanks for watching", "bye", "goodbye", "you", "the end",
  "subscribe", "please subscribe", "amara.org", "subtitles by the amara.org community",
]);

export function isHallucination(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,\s]+$/g, "");
  return t.length === 0 || HALLUCINATIONS.has(t);
}

export type ClipResult = { text: string; model: string; label: string } | null;

export type ClipRunSummary = {
  results: ClipResult[];
  /** Engine/model → clips it transcribed. */
  usage: Record<string, number>;
  /** Short reasons candidates failed (no keys). */
  failures: string[];
};

/**
 * Transcribe every clip. Each clip walks the candidates in order; a candidate
 * with a bad key or exhausted quota is skipped for the rest of the run, and a
 * candidate that fails 3 clips in a row is dropped. A clip nobody can transcribe is null.
 */
export async function transcribeClips(
  candidates: SttCandidate[],
  clips: { audio: Buffer; mime: string }[],
  ctx: { languages: SttLanguages; vocabulary: string[]; promptHint: string },
  deps?: SttDeps & { concurrency?: number; engines?: Record<SttEngineId, SttEngine> },
): Promise<ClipRunSummary> {
  const engines = deps?.engines ?? STT_ENGINES;
  const dead = new Set<number>();
  const strikes = new Map<number, number>();
  const failures: string[] = [];
  const usage: Record<string, number> = {};
  const results: ClipResult[] = new Array(clips.length).fill(null);
  let next = 0;

  const worker = async () => {
    for (let i = next++; i < clips.length; i = next++) {
      const req: SttClipRequest = { ...clips[i], ...ctx };
      for (let c = 0; c < candidates.length; c++) {
        if (dead.has(c)) continue;
        const cand = candidates[c];
        try {
          const { text, model } = await engines[cand.engine].transcribeClip(cand, req, deps);
          strikes.set(c, 0);
          if (cand.engine !== "gemini" && isHallucination(text)) {
            results[i] = { text: "", model, label: cand.label };
          } else {
            results[i] = { text, model, label: cand.label };
          }
          usage[`${cand.engine}:${model}`] = (usage[`${cand.engine}:${model}`] ?? 0) + 1;
          break;
        } catch (err) {
          const status = err instanceof SttHttpError ? err.status : 0;
          const msg = err instanceof Error ? err.message.slice(0, 160) : String(err);
          if (status === 401 || status === 403 || status === 429) {
            dead.add(c);
            failures.push(`${cand.label}: ${msg}`);
          } else {
            const n = (strikes.get(c) ?? 0) + 1;
            strikes.set(c, n);
            if (n >= 3) {
              dead.add(c);
              failures.push(`${cand.label}: ${msg}`);
            }
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(deps?.concurrency ?? 3, clips.length || 1)) }, worker));
  return { results, usage, failures };
}
