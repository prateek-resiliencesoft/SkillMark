/**
 * What each AI provider can do inside the app. Client-safe (no secrets, no server imports):
 * the settings UI uses it for grouping/warnings and the server re-checks the same rules.
 */

export type ProviderCapId = "openai" | "gemini" | "nvidia" | "anthropic" | "custom";

export type ProviderCaps = {
  /** Can run live voice interviews (realtime speech in / speech out). */
  voice: boolean;
  /** One-line verdict shown on the card. */
  summary: string;
  pros: string[];
  limits: string[];
  /** Features in the app this key powers. */
  usedFor: string[];
};

export const PROVIDER_CAPS: Record<ProviderCapId, ProviderCaps> = {
  openai: {
    voice: true,
    summary: "Voice + text. Realtime speech and strong reasoning.",
    pros: [
      "Realtime voice model for natural, interruptible interviews",
      "Very reliable structured output (scoring, reports)",
      "Best for deep multi-level rounds",
    ],
    limits: [
      "Realtime voice is billed per audio minute — the priciest option",
      "Rate limits on new accounts can be low",
    ],
    usedFor: ["Voice interviews", "Chat interviews", "Reports & scoring", "CV parsing", "Question generation"],
  },
  gemini: {
    voice: true,
    summary: "Voice + text. Fast and low cost, great for screening.",
    pros: [
      "Gemini Live gives low-latency voice at a lower price",
      "Large context window — good for long CVs",
      "Generous free tier for testing",
    ],
    limits: [
      "Voice quality and accents vary by language",
      "Free tier is rate limited and may log data — use a paid key in production",
    ],
    usedFor: ["Voice interviews", "Chat interviews", "Reports & scoring", "CV parsing", "Question generation"],
  },
  nvidia: {
    voice: false,
    summary: "Text only. Hosted open models, cheap backup.",
    pros: [
      "Runs open models (Llama and others) on NVIDIA NIM",
      "Cheap and fast for light tasks",
      "Good backup when other providers are rate limited",
    ],
    limits: [
      "No realtime voice models — cannot run voice interviews",
      "Weaker structured output than OpenAI or Claude on hard tasks",
    ],
    usedFor: ["Chat interviews", "Reports & scoring", "CV parsing", "Question generation"],
  },
  anthropic: {
    voice: false,
    summary: "Text only. Best writing and careful analysis.",
    pros: [
      "Excellent at nuanced follow-ups and written feedback",
      "Strong reports and long-document reasoning",
      "Very good at following detailed interview rubrics",
    ],
    limits: [
      "No voice models — Claude cannot listen or speak, so it cannot run voice interviews",
      "Use Gemini or OpenAI for voice; keep Claude for text work",
    ],
    usedFor: ["Chat interviews", "Reports & scoring", "CV parsing", "Question generation"],
  },
  custom: {
    voice: true,
    summary: "Any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM).",
    pros: [
      "Keeps data on your own infrastructure",
      "Use any model you host",
      "No per-token vendor bill",
    ],
    limits: [
      "Voice works only with a realtime model that speaks the OpenAI Realtime protocol",
      "Quality, speed and uptime depend on your hardware",
    ],
    usedFor: ["Chat interviews (any model)", "Voice interviews (realtime model only)", "Reports", "CV parsing", "Question generation"],
  },
};

/** Providers that can appear in the voice-interview priority list. */
export function isVoiceCapableProvider(id: string): boolean {
  return (PROVIDER_CAPS as Record<string, ProviderCaps | undefined>)[id]?.voice === true;
}

export const VOICE_PROVIDER_IDS = (Object.keys(PROVIDER_CAPS) as ProviderCapId[]).filter(
  (id) => PROVIDER_CAPS[id].voice,
);

/** Why a provider can't take part in voice interviews (for warnings). */
export function voiceBlockedReason(id: string): string | null {
  if (id === "anthropic") {
    return "Anthropic (Claude) has no voice models, so it can't run voice interviews. Use Gemini or OpenAI for voice — keep Claude for chat interviews, reports and CV parsing.";
  }
  if (id === "nvidia") {
    return "NVIDIA doesn't offer a realtime voice model here, so it can't run voice interviews. Use Gemini or OpenAI for voice — keep NVIDIA as a text backup.";
  }
  return null;
}

export type VoiceModelCheck = { ok: true; note: string } | { ok: false; reason: string };

// Names of models that stream speech in and out in real time.
const VOICE_OK = [
  /realtime/i, // gpt-4o-realtime-preview, gpt-realtime
  /(^|[-_/.])live([-_/.]|$)/i, // gemini-*-live-*
  /native-audio/i, // gemini-*-native-audio-*
  /audio-preview/i, // gpt-4o-audio-preview
  /voxtral/i,
  /ultravox/i,
  /moshi/i,
  /qwen.*omni/i,
  /(^|[-_/.])omni([-_/.]|$)/i,
];

// Clearly text-only families — give a specific error instead of a generic one.
const TEXT_ONLY = [
  /claude/i,
  /llama/i,
  /mistral|mixtral/i,
  /qwen/i,
  /deepseek/i,
  /gemma/i,
  /phi[-\d]/i,
  /(^|[-_/])gpt-(3|4|4o|4\.1|5)(-mini|-nano|-turbo)?$/i,
  /gemini-[\d.]+-(flash|pro)(-lite)?$/i,
  /embed/i,
];

/**
 * Best-effort check that a model id can run a LIVE voice interview. Name-based, so it
 * can't see inside a custom endpoint — hence the explicit allow-list of realtime families.
 */
export function checkVoiceModel(modelId: string | null | undefined): VoiceModelCheck {
  const id = (modelId ?? "").trim();
  if (!id) return { ok: false, reason: "Enter a voice model id (for example gpt-4o-realtime-preview)." };
  if (VOICE_OK.some((re) => re.test(id))) {
    return { ok: true, note: `"${id}" looks like a realtime voice model.` };
  }
  if (TEXT_ONLY.some((re) => re.test(id))) {
    return {
      ok: false,
      reason: `"${id}" is a text model and can't run voice interviews. Use a realtime/audio model such as gpt-4o-realtime-preview or a Gemini Live model, or keep it under chat.`,
    };
  }
  return {
    ok: false,
    reason: `Can't confirm "${id}" supports realtime voice. Voice needs a realtime model (name usually contains "realtime", "live", "audio" or "omni"). Use it as a chat model instead.`,
  };
}
