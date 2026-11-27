import "server-only";
import { DEFAULT_TASK_ROUTING, isSttProvider, taskModelOverride, type AiProviderId } from "@/lib/ai/credentials";
import { loadCredsPair } from "@/lib/ai/registry";
import { defaultSttModel, resolveSttConfig, type SttTarget } from "@/lib/round-two/stt-config";
import { GEMINI_TRANSCRIBE_MODEL } from "@/lib/transcript/stt-engines";

const OPENAI_BASE = "https://api.openai.com/v1";
const MAX_TARGETS = 3;

/**
 * Ordered speech-to-text endpoints for one org's round 2 transcript, sent to the
 * (authenticated) transcription agent with each live room.
 *
 * Order: Settings → AI "Round 2 transcript" routing if the org saved one; otherwise
 * the ROUND2_STT_* env endpoint first, then AI_ROUTING_ROUND2_TRANSCRIPT / the default
 * (Groq → OpenAI → Custom), then the org's Gemini key last. Keys come from the org's AI providers, then env.
 * Tenant-supplied custom base URLs are never used here (the agent runs inside the
 * private network), only a platform CUSTOM_LLM_BASE_URL.
 */
export async function resolveRoundTwoStt(organizationId: string | null | undefined): Promise<SttTarget[]> {
  const { merged, routing } = await loadCredsPair(organizationId);
  const stored = (routing.round2_transcript ?? []).filter((id) => isSttProvider(id));
  const order: AiProviderId[] = stored.length ? stored : DEFAULT_TASK_ROUTING.round2_transcript;

  const out: SttTarget[] = [];
  const push = (t: SttTarget | null) => {
    if (!t || !t.apiKey || out.some((x) => x.baseUrl === t.baseUrl && x.apiKey === t.apiKey)) return;
    out.push(t);
  };

  if (!stored.length) {
    const env = resolveSttConfig(process.env);
    if (process.env.ROUND2_STT_API_KEY?.trim() || process.env.ROUND2_STT_BASE_URL?.trim()) {
      push({ provider: env.provider, baseUrl: env.baseUrl, model: env.model, apiKey: env.apiKey });
    }
  }

  for (const id of order) {
    const c = merged[id];
    const key = c?.apiKeys[0];
    if (!key) continue;
    if (id === "groq") {
      push({ provider: "groq", baseUrl: (c.baseUrl || "https://api.groq.com/openai/v1").replace(/\/+$/, ""), model: taskModelOverride("round2_transcript", "groq") || defaultSttModel("groq"), apiKey: key });
    } else if (id === "openai") {
      push({ provider: "openai", baseUrl: (c.baseUrl || OPENAI_BASE).replace(/\/+$/, ""), model: taskModelOverride("round2_transcript", "openai") || defaultSttModel("openai"), apiKey: key });
    } else if (id === "custom") {
      if (c.untrustedBaseUrl || !c.baseUrl) continue;
      push({
        provider: "custom",
        baseUrl: c.baseUrl.replace(/\/+$/, ""),
        model: taskModelOverride("round2_transcript", "custom") || process.env.CUSTOM_STT_MODEL || defaultSttModel("custom"),
        apiKey: key,
      });
    }
  }
  // Gemini has no /audio/transcriptions endpoint, so it isn't in the routing list above, but an org
  // whose only speech-capable key is Gemini must still get a live transcript (gemini-3.5-transcribe).
  const gemini = merged.gemini?.apiKeys[0];
  if (gemini && out.length < MAX_TARGETS) {
    push({ provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: GEMINI_TRANSCRIBE_MODEL, apiKey: gemini });
  }
  return out.slice(0, MAX_TARGETS);
}
