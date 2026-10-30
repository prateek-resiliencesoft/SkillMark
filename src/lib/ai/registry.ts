import type { AiProviderId, ResolvedAiCredentials } from "./credentials";
import { loadOrgAiCredentials } from "./credentials";
import { AnthropicProvider } from "./providers/anthropic";
import { CompatibleOpenAIProvider } from "./providers/compatible";
import { KimiProvider } from "./providers/kimi";
import { MinimaxProvider } from "./providers/minimax";
import { OpenAIProvider } from "./providers/openai";
import type { LLMProvider } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

function openaiModels() {
  return Array.from(
    new Set(
      [process.env.OPENAI_MODEL, process.env.OPENAI_REPORT_MODEL, "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o3-mini"].filter(
        (m): m is string => !!m,
      ),
    ),
  );
}

function geminiModels() {
  // gemini-2.0 / 2.5 Flash shut down for new keys (404). Prefer current Flash.
  const d = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  return Array.from(new Set([d, "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"]));
}

function nvidiaModels() {
  const d = process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct";
  return Array.from(new Set([d, "meta/llama-3.1-8b-instruct", "meta/llama-3.1-70b-instruct"]));
}

function customModels() {
  const d = process.env.CUSTOM_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  return Array.from(new Set([d, "gpt-4o-mini", "llama3.2", "qwen2.5"]));
}

function buildFromCreds(creds: ResolvedAiCredentials): Map<string, LLMProvider> {
  const map = new Map<string, LLMProvider>();

  map.set(
    "openai",
    new CompatibleOpenAIProvider({
      id: "openai",
      name: "OpenAI",
      models: openaiModels(),
      defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: creds.openai.apiKey,
      baseURL: creds.openai.baseUrl,
    }),
  );

  map.set(
    "gemini",
    new CompatibleOpenAIProvider({
      id: "gemini",
      name: "Google Gemini",
      models: geminiModels(),
      defaultModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
      apiKey: creds.gemini.apiKey,
      baseURL: creds.gemini.baseUrl,
    }),
  );

  map.set(
    "nvidia",
    new CompatibleOpenAIProvider({
      id: "nvidia",
      name: "NVIDIA",
      models: nvidiaModels(),
      defaultModel: process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct",
      apiKey: creds.nvidia.apiKey,
      baseURL: creds.nvidia.baseUrl,
    }),
  );

  map.set(
    "anthropic",
    new AnthropicProvider({
      apiKey: creds.anthropic.apiKey,
      defaultModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    }),
  );

  map.set(
    "custom",
    new CompatibleOpenAIProvider({
      id: "custom",
      name: "Custom / local",
      models: customModels(),
      defaultModel: process.env.CUSTOM_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: creds.custom.apiKey || "ollama",
      baseURL: creds.custom.baseUrl,
    }),
  );

  // Legacy env-only providers (not in Settings → AI UI).
  map.set("kimi", new KimiProvider());
  map.set("minimax", new MinimaxProvider());

  return map;
}

const SETTINGS_ORDER: AiProviderId[] = ["openai", "gemini", "nvidia", "anthropic", "custom"];
const LEGACY_ORDER = ["kimi", "minimax"] as const;

function pickDefault(map: Map<string, LLMProvider>, creds: ResolvedAiCredentials): LLMProvider {
  // Org Settings → AI always wins over .env when any org key is present.
  const preferOrg = SETTINGS_ORDER.some((id) => creds[id].from === "org");
  for (const id of SETTINGS_ORDER) {
    const from = creds[id].from;
    if (preferOrg ? from === "org" : from !== "none") {
      if (map.has(id) && creds[id].apiKey) return map.get(id)!;
    }
  }
  // Legacy env-only providers (Kimi / MiniMax) — last resort, never above Settings.
  for (const id of LEGACY_ORDER) {
    if (id === "kimi" && process.env.KIMI_API_KEY) return map.get(id)!;
    if (id === "minimax" && process.env.MINIMAX_API_KEY) return map.get(id)!;
  }
  throw new Error(
    "No LLM provider configured. Add an API key in Project Settings → AI, or set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / NVIDIA_API_KEY in .env.",
  );
}

function matchProvider(map: Map<string, LLMProvider>, idOrModel?: string | null): LLMProvider | null {
  if (!idOrModel) return null;
  if (map.has(idOrModel)) return map.get(idOrModel)!;
  for (const p of map.values()) {
    if (p.models.some((m) => m.toLowerCase() === idOrModel.toLowerCase())) return p;
  }
  return null;
}

/** Sync env-only resolver (tests / callers without org context). */
export function getProvider(idOrModel?: string | null): LLMProvider {
  // Empty org → env-only credentials
  const empty = {
    openai: { apiKey: process.env.OPENAI_API_KEY ?? "", baseUrl: process.env.OPENAI_BASE_URL, from: process.env.OPENAI_API_KEY ? "env" : "none" },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      from: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "env" : "none",
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || "",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      from: process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY ? "env" : "none",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      baseUrl: undefined,
      from: process.env.ANTHROPIC_API_KEY ? "env" : "none",
    },
    custom: {
      apiKey: process.env.CUSTOM_LLM_API_KEY || process.env.OPENAI_API_KEY || "",
      baseUrl: process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
      from: process.env.CUSTOM_LLM_API_KEY || process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_API_KEY ? "env" : "none",
    },
  } as ResolvedAiCredentials;

  const map = buildFromCreds(empty);
  return matchProvider(map, idOrModel) ?? pickDefault(map, empty);
}

export function listProviders(): LLMProvider[] {
  return Array.from(buildFromCreds(resolveEmptyCreds()).values());
}

function resolveEmptyCreds(): ResolvedAiCredentials {
  return {
    openai: { apiKey: process.env.OPENAI_API_KEY ?? "", baseUrl: process.env.OPENAI_BASE_URL, from: process.env.OPENAI_API_KEY ? "env" : "none" },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      from: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "env" : "none",
    },
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY || "",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      from: process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY ? "env" : "none",
    },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY ?? "", from: process.env.ANTHROPIC_API_KEY ? "env" : "none" },
    custom: {
      apiKey: process.env.CUSTOM_LLM_API_KEY || process.env.OPENAI_API_KEY || "",
      baseUrl: process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
      from: process.env.CUSTOM_LLM_BASE_URL || process.env.CUSTOM_LLM_API_KEY ? "env" : "none",
    },
  };
}

/** Org-aware provider: org key first, else .env. */
export async function resolveProvider(opts?: {
  organizationId?: string | null;
  idOrModel?: string | null;
}): Promise<LLMProvider> {
  const creds = await loadOrgAiCredentials(supabaseAdmin, opts?.organizationId);
  const map = buildFromCreds(creds);
  return matchProvider(map, opts?.idOrModel) ?? pickDefault(map, creds);
}

export async function resolveTaskModels(organizationId?: string | null): Promise<{
  provider: LLMProvider;
  generatorModel: string;
  reportModel: string;
}> {
  const creds = await loadOrgAiCredentials(supabaseAdmin, organizationId);
  const map = buildFromCreds(creds);
  const provider = pickDefault(map, creds);

  const generatorModel =
    provider.id === "openai"
      ? process.env.OPENAI_MODEL || provider.defaultModel
      : provider.id === "gemini"
        ? process.env.GEMINI_MODEL || provider.defaultModel
        : provider.id === "nvidia"
          ? process.env.NVIDIA_MODEL || provider.defaultModel
          : provider.id === "anthropic"
            ? process.env.ANTHROPIC_MODEL || provider.defaultModel
            : provider.id === "custom"
              ? process.env.CUSTOM_LLM_MODEL || provider.defaultModel
              : provider.id === "kimi"
                ? "moonshot-v1-8k"
                : "MiniMax-M2.1-lightning";

  const reportModel =
    provider.id === "openai"
      ? process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-4o"
      : provider.id === "gemini"
        ? process.env.GEMINI_REPORT_MODEL || process.env.GEMINI_MODEL || provider.defaultModel
        : provider.id === "anthropic"
          ? process.env.ANTHROPIC_REPORT_MODEL || process.env.ANTHROPIC_MODEL || provider.defaultModel
          : provider.defaultModel;

  return { provider, generatorModel, reportModel };
}

/** @deprecated Prefer resolveTaskModels — kept for sync callers. */
export const REPORT_MODEL = process.env.OPENAI_API_KEY
  ? process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-4o"
  : process.env.KIMI_API_KEY
    ? "kimi-k2.5"
    : "MiniMax-M2.1-lightning";

/** @deprecated Prefer resolveTaskModels — kept for sync callers. */
export const GENERATOR_MODEL = process.env.OPENAI_API_KEY
  ? process.env.OPENAI_MODEL || "gpt-4o-mini"
  : process.env.KIMI_API_KEY
    ? "moonshot-v1-8k"
    : "MiniMax-M2.1-lightning";

// Re-export legacy class for any direct imports
export { OpenAIProvider };

/** Other configured providers (in Settings order) to fall back to when the primary is rate-limited. */
export async function resolveFallbackProviders(
  organizationId: string | null | undefined,
  excludeId: string,
): Promise<{ provider: LLMProvider; model: string }[]> {
  const creds = await loadOrgAiCredentials(supabaseAdmin, organizationId);
  const map = buildFromCreds(creds);
  const envModel: Record<string, string | undefined> = {
    openai: process.env.OPENAI_MODEL,
    gemini: process.env.GEMINI_MODEL,
    nvidia: process.env.NVIDIA_MODEL,
    anthropic: process.env.ANTHROPIC_MODEL,
    custom: process.env.CUSTOM_LLM_MODEL,
  };
  const out: { provider: LLMProvider; model: string }[] = [];
  for (const id of SETTINGS_ORDER) {
    if (id === excludeId || !creds[id].apiKey || !map.has(id)) continue;
    const provider = map.get(id)!;
    out.push({ provider, model: envModel[id] || provider.defaultModel });
  }
  return out;
}
