import type { AiProviderId, ResolvedAiCredentials } from "./credentials";
import { decryptAiProviders, resolveCredentials } from "./credentials";
import { createLogger } from "@/lib/logger";
import { AnthropicProvider } from "./providers/anthropic";
import { CompatibleOpenAIProvider } from "./providers/compatible";
import { KimiProvider } from "./providers/kimi";
import { MinimaxProvider } from "./providers/minimax";
import { OpenAIProvider } from "./providers/openai";
import type { LLMProvider } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const log = createLogger("ai/registry");

type ChainEntry = { provider: LLMProvider; model: string; source: "org" | "env" };

function modelFor(provider: LLMProvider, kind: "generator" | "report" = "generator"): string {
  const id = provider.id;
  if (kind === "report") {
    if (id === "openai") return process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
    if (id === "gemini") return process.env.GEMINI_REPORT_MODEL || process.env.GEMINI_MODEL || provider.defaultModel;
    if (id === "anthropic") return process.env.ANTHROPIC_REPORT_MODEL || process.env.ANTHROPIC_MODEL || provider.defaultModel;
  }
  const envModel: Record<string, string | undefined> = {
    openai: process.env.OPENAI_MODEL,
    gemini: process.env.GEMINI_MODEL,
    nvidia: process.env.NVIDIA_MODEL,
    anthropic: process.env.ANTHROPIC_MODEL,
    custom: process.env.CUSTOM_LLM_MODEL,
    kimi: "moonshot-v1-8k",
    minimax: "MiniMax-M2.1-lightning",
  };
  return envModel[id] || provider.defaultModel;
}

/** Org keys + env keys, read fresh from the DB on every call (no caching). */
async function loadCredsPair(organizationId?: string | null) {
  let orgPlain = {};
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from("org_integrations")
      .select("aiProviders")
      .eq("organizationId", organizationId)
      .maybeSingle();
    orgPlain = decryptAiProviders(data?.aiProviders);
  }
  return { merged: resolveCredentials(orgPlain), envOnly: resolveCredentials({}) };
}

/**
 * Ordered candidates: the .env default keys FIRST (Settings order), then the
 * org's saved AI Provider keys (skipping keys identical to an env key). Legacy
 * Kimi/MiniMax last. Failover moves down this list on quota/auth errors.
 */
export async function resolveProviderChain(organizationId?: string | null): Promise<ChainEntry[]> {
  const { merged, envOnly } = await loadCredsPair(organizationId);
  const orgMap = buildFromCreds(merged);
  const envMap = buildFromCreds(envOnly);
  const chain: ChainEntry[] = [];
  const seenKeys = new Set<string>();
  for (const id of SETTINGS_ORDER) {
    const k = envOnly[id].apiKey;
    if (envOnly[id].from === "env" && k && envMap.has(id)) {
      chain.push({ provider: envMap.get(id)!, model: modelFor(envMap.get(id)!), source: "env" });
      seenKeys.add(`${id}:${k}`);
    }
  }
  for (const id of SETTINGS_ORDER) {
    const k = merged[id].apiKey;
    if (merged[id].from === "org" && k && !seenKeys.has(`${id}:${k}`) && orgMap.has(id)) {
      chain.push({ provider: orgMap.get(id)!, model: modelFor(orgMap.get(id)!), source: "org" });
      seenKeys.add(`${id}:${k}`);
    }
  }
  if (process.env.KIMI_API_KEY && envMap.has("kimi")) chain.push({ provider: envMap.get("kimi")!, model: modelFor(envMap.get("kimi")!), source: "env" });
  if (process.env.MINIMAX_API_KEY && envMap.has("minimax")) chain.push({ provider: envMap.get("minimax")!, model: modelFor(envMap.get("minimax")!), source: "env" });
  return chain;
}

export function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; code?: string };
  if (e?.status === 429) return true;
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(e?.message ?? "");
}

/** Quota/limit, or a missing/invalid/unauthorized key → try the next key. */
export function shouldFailover(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (isQuotaError(err)) return true;
  if (e?.status === 401 || e?.status === 403) return true;
  return /api key not valid|invalid api key|incorrect api key|API_KEY_INVALID|unauthori[sz]ed|permission denied/i.test(e?.message ?? "");
}

/**
 * Wraps the chain: on 429/quota it moves to the next key/provider. The caller's
 * model is used only for the first entry; others use their own default model.
 */
export class FailoverProvider implements LLMProvider {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  private last: ChainEntry;
  constructor(private chain: ChainEntry[]) {
    this.last = chain[0];
    this.id = chain[0].provider.id;
    this.name = chain[0].provider.name;
    this.models = chain[0].provider.models;
    this.defaultModel = chain[0].provider.defaultModel;
  }
  /** Underlying SDK client of the entry tried last (used by quota probes). */
  get client(): unknown {
    return (this.last.provider as unknown as { client?: unknown }).client;
  }
  get lastProviderLabel(): string {
    return `${this.last.provider.id}/${this.last.source}`;
  }
  /** Clear error once every key has failed; keeps .status so callers can detect 429. */
  private allFailed(err: unknown): Error {
    const e = err as { status?: number; message?: string };
    const tried = this.chain.map((c) => `${c.provider.id}/${c.source}`).join(", ");
    const out = new Error(
      `All AI keys failed (${tried}). Last error: ${e?.message ?? String(err)}. Add or check keys in Settings → AI Providers.`,
    ) as Error & { status?: number };
    out.status = e?.status;
    log.error(`All AI keys failed: ${tried}`);
    return out;
  }
  private modelForEntry(i: number, requested?: string) {
    const e = this.chain[i];
    if (i === 0 && requested) return requested;
    if (requested && e.provider.models.some((m) => m.toLowerCase() === requested.toLowerCase())) return requested;
    return e.model;
  }
  async generateResponse(params: Parameters<LLMProvider["generateResponse"]>[0]) {
    let lastErr: unknown;
    for (let i = 0; i < this.chain.length; i++) {
      const e = this.chain[i];
      this.last = e;
      try {
        const res = await e.provider.generateResponse({ ...params, model: this.modelForEntry(i, params.model) });
        log.info(`AI call served by ${e.provider.id} (${e.source} key)${i > 0 ? " after failover" : ""}`);
        return res;
      } catch (err) {
        lastErr = err;
        if (!shouldFailover(err)) throw err;
        if (i === this.chain.length - 1) throw this.allFailed(err);
        log.warn(`${e.provider.id} (${e.source} key) failed (${(err as { status?: number })?.status ?? "quota/auth"}) — trying next key`);
      }
    }
    throw lastErr;
  }
  async *streamResponse(params: Parameters<LLMProvider["streamResponse"]>[0]) {
    let lastErr: unknown;
    for (let i = 0; i < this.chain.length; i++) {
      const e = this.chain[i];
      this.last = e;
      let yielded = false;
      try {
        for await (const t of e.provider.streamResponse({ ...params, model: this.modelForEntry(i, params.model) })) {
          yielded = true;
          yield t;
        }
        return;
      } catch (err) {
        lastErr = err;
        if (yielded || !shouldFailover(err)) throw err;
        if (i === this.chain.length - 1) throw this.allFailed(err);
        log.warn(`${e.provider.id} (${e.source} key) failed (${(err as { status?: number })?.status ?? "quota/auth"}) — trying next key`);
      }
    }
    throw lastErr;
  }
}

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
  // Prefer current Flash; keep aliases so dead-model retries can cascade.
  const d = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  return Array.from(
    new Set([d, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"]),
  );
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

/** Provider with failover: .env default key first, then org-saved keys. */
export async function resolveProvider(opts?: {
  organizationId?: string | null;
  idOrModel?: string | null;
}): Promise<LLMProvider> {
  const chain = await resolveProviderChain(opts?.organizationId);
  if (!chain.length) {
    throw new Error(
      "No LLM provider configured. Add an API key in Settings → AI Providers, or set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / NVIDIA_API_KEY in .env.",
    );
  }
  // Interview-level provider/model preference: move the first matching entry to the front.
  if (opts?.idOrModel) {
    const want = opts.idOrModel.toLowerCase();
    const idx = chain.findIndex(
      (e) => e.provider.id === want || e.provider.models.some((m) => m.toLowerCase() === want),
    );
    if (idx > 0) chain.unshift(...chain.splice(idx, 1));
  }
  log.info(
    `AI provider chain${opts?.organizationId ? ` (org ${opts.organizationId.slice(0, 8)})` : " (no org)"}: ${chain
      .map((e) => `${e.provider.id}/${e.source}`)
      .join(" → ")}`,
  );
  return new FailoverProvider(chain);
}

export async function resolveTaskModels(organizationId?: string | null): Promise<{
  provider: LLMProvider;
  generatorModel: string;
  reportModel: string;
}> {
  const provider = (await resolveProvider({ organizationId })) as FailoverProvider;
  const head = (provider as unknown as { chain: ChainEntry[] }).chain[0].provider;
  return { provider, generatorModel: modelFor(head), reportModel: modelFor(head, "report") };
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

/** @deprecated Failover is built into resolveProvider/resolveTaskModels; kept for callers. */
export async function resolveFallbackProviders(
  _organizationId: string | null | undefined,
  _excludeId: string,
): Promise<{ provider: LLMProvider; model: string }[]> {
  return [];
}
