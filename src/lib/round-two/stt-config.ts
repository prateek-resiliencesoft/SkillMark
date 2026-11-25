/**
 * Round 2 agent STT settings (pure, shared with tests).
 * Any OpenAI-compatible /audio/transcriptions endpoint works; Groq needs its own key and a Whisper model.
 */
export interface SttConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  provider: "openai" | "groq" | "custom";
}

type Env = Record<string, string | undefined>;

export function resolveSttConfig(env: Env): SttConfig {
  const baseUrl = (env.ROUND2_STT_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const provider = /(^|\.)groq\.com\b/i.test(new URL(baseUrl).hostname)
    ? "groq"
    : /(^|\.)openai\.com$/i.test(new URL(baseUrl).hostname)
      ? "openai"
      : "custom";
  const model =
    env.ROUND2_STT_MODEL?.trim() || (provider === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe");
  // Never send the OpenAI key to another provider.
  const apiKey =
    env.ROUND2_STT_API_KEY?.trim() ||
    (provider === "groq" ? env.GROQ_API_KEY?.trim() : provider === "openai" ? env.OPENAI_API_KEY?.trim() : "") ||
    "";
  return { baseUrl, model, apiKey, provider };
}

/** Utterance timestamps must be whole epoch ms (resampled audio frames give fractional durations). */
export function segmentTimes(startedAt: number, endedAt: number): { startedAt: number; endedAt: number } {
  const s = Math.round(startedAt);
  return { startedAt: s, endedAt: Math.max(s, Math.round(endedAt)) };
}
