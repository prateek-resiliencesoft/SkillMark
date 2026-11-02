import type { AiProviderId, AiTaskKind, ResolvedAiCredentials } from "./credentials";
import {
  DEFAULT_TASK_ROUTING,
  decryptAiProviders,
  defaultModelForProvider,
  resolveCredentials,
  routingForTask,
} from "./credentials";
import { createLogger } from "@/lib/logger";
import { AnthropicProvider } from "./providers/anthropic";
import { CompatibleOpenAIProvider } from "./providers/compatible";
import { KimiProvider } from "./providers/kimi";
import { MinimaxProvider } from "./providers/minimax";
import { OpenAIProvider } from "./providers/openai";
import type { LLMProvider } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const log = createLogger("ai/registry");

type ChainEntry = {
  provider: LLMProvider;
  model: string;
  source: "org" | "env";
  keyIndex: number;
};

function modelFor(provider: LLMProvider, kind: "generator" | "report" = "generator"): string {
  const id = provider.id;
  if (kind === "report") {
    if (id === "openai") return process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
    if (id === "gemini") return process.env.GEMINI_REPORT_MODEL || process.env.GEMINI_MODEL || provider.defaultModel;
    if (id === "anthropic") return process.env.ANTHROPIC_REPORT_MODEL || process.env.ANTHROPIC_MODEL || provider.defaultModel;
  }
  if (id === "kimi") return "moonshot-v1-8k";
  if (id === "minimax") return "MiniMax-M2.1-lightning";
  if (
    id === "openai" ||
    id === "gemini" ||
    id === "nvidia" ||
    id === "anthropic" ||
    id === "custom"
  ) {
    return defaultModelForProvider(id);
  }
  return provider.defaultModel;
}

/** Org keys + env keys, read fresh from the DB on every call (no caching). */
async function loadCredsPair(organizationId?: string | null) {
  let orgPlain = decryptAiProviders({});
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from("org_integrations")
      .select("aiProviders")
      .eq("organizationId", organizationId)
      .maybeSingle();
    orgPlain = decryptAiProviders(data?.aiProviders);
  }
  return {
    merged: resolveCredentials(orgPlain),
    envOnly: resolveCredentials({}),
    routing: orgPlain.routing ?? {},
    orgPlain,
  };
}

function providerInstance(
  id: AiProviderId,
  apiKey: string,
  baseUrl: string | undefined,
): LLMProvider | null {
  if (!apiKey && id !== "custom") return null;
  if (id === "openai") {
    return new CompatibleOpenAIProvider({
      id: "openai",
      name: "OpenAI",
      models: openaiModels(),
      defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey,
      baseURL: baseUrl,
    });
  }
  if (id === "gemini") {
    return new CompatibleOpenAIProvider({
      id: "gemini",
      name: "Google Gemini",
      models: geminiModels(),
      defaultModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
      apiKey,
      baseURL: baseUrl,
    });
  }
  if (id === "nvidia") {
    return new CompatibleOpenAIProvider({
      id: "nvidia",
      name: "NVIDIA",
      models: nvidiaModels(),
      defaultModel: process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct",
      apiKey,
      baseURL: baseUrl,
    });
  }
  if (id === "anthropic") {
    return new AnthropicProvider({
      apiKey,
      defaultModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    });
  }
  if (id === "custom") {
    return new CompatibleOpenAIProvider({
      id: "custom",
      name: "Custom / local",
      models: customModels(),
      defaultModel: process.env.CUSTOM_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: apiKey || "ollama",
      baseURL: baseUrl,
    });
  }
  return null;
}

/**
 * Ordered candidates for a workload:
 * 1) Org routing order for the task (each provider's keys 1→N)
 * 2) Remaining org providers/keys not already listed
 * 3) Env keys
 * 4) Legacy Kimi/MiniMax
 *
 * Failover walks this list silently until one works.
 */
export async function resolveProviderChain(
  organizationId?: string | null,
  task: AiTaskKind = "standard",
): Promise<ChainEntry[]> {
  const { merged, envOnly, routing } = await loadCredsPair(organizationId);
  const order = routingForTask(routing, task);
  const chain: ChainEntry[] = [];
  const seenKeys = new Set<string>();

  const pushKeys = (
    id: AiProviderId,
    keys: string[],
    baseUrl: string | undefined,
    source: "org" | "env",
  ) => {
    keys.forEach((k, keyIndex) => {
      if (!k || seenKeys.has(`${id}:${k}`)) return;
      const provider = providerInstance(id, k, baseUrl);
      if (!provider) return;
      chain.push({
        provider,
        model: modelFor(provider),
        source,
        keyIndex,
      });
      seenKeys.add(`${id}:${k}`);
    });
  };

  // Org keys in task priority order (primary → backups), each with up to 5 keys.
  for (const id of order) {
    if (merged[id].from === "org" && merged[id].apiKeys.length) {
      pushKeys(id, merged[id].apiKeys, merged[id].baseUrl, "org");
    }
  }
  // Any other org-configured providers not in the task list.
  for (const id of SETTINGS_ORDER) {
    if (order.includes(id)) continue;
    if (merged[id].from === "org" && merged[id].apiKeys.length) {
      pushKeys(id, merged[id].apiKeys, merged[id].baseUrl, "org");
    }
  }
  // Env fallbacks last (platform defaults).
  for (const id of order.length ? order : SETTINGS_ORDER) {
    if (envOnly[id].from === "env" && envOnly[id].apiKeys.length) {
      pushKeys(id, envOnly[id].apiKeys, envOnly[id].baseUrl, "env");
    }
  }
  for (const id of SETTINGS_ORDER) {
    if (envOnly[id].from === "env" && envOnly[id].apiKeys.length) {
      pushKeys(id, envOnly[id].apiKeys, envOnly[id].baseUrl, "env");
    }
  }

  const envMap = buildFromCreds(envOnly);
  if (process.env.KIMI_API_KEY && envMap.has("kimi")) {
    chain.push({
      provider: envMap.get("kimi")!,
      model: modelFor(envMap.get("kimi")!),
      source: "env",
      keyIndex: 0,
    });
  }
  if (process.env.MINIMAX_API_KEY && envMap.has("minimax")) {
    chain.push({
      provider: envMap.get("minimax")!,
      model: modelFor(envMap.get("minimax")!),
      source: "env",
      keyIndex: 0,
    });
  }
  return chain;
}

export function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; code?: string };
  if (e?.status === 429) return true;
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(e?.message ?? "");
}

/** Transient / auth / quota / dead model → try next key or provider. Client only sees error after chain exhausted. */
export function shouldFailover(err: unknown): boolean {
  const e = err as { status?: number; message?: string; code?: string; name?: string };
  if (isQuotaError(err)) return true;
  if (e?.status === 401 || e?.status === 403) return true;
  // Wrong/retired model id for this provider — try next key/provider with its own model.
  if (e?.status === 404 || e?.status === 410) return true;
  if (e?.status === 408 || e?.status === 500 || e?.status === 502 || e?.status === 503 || e?.status === 504) {
    return true;
  }
  const msg = e?.message ?? "";
  if (/api key not valid|invalid api key|incorrect api key|API_KEY_INVALID|unauthori[sz]ed|permission denied/i.test(msg)) {
    return true;
  }
  if (/410\s+status code|gone|retired|no longer (available|supported)|model .*unavailable|not found/i.test(msg)) {
    return true;
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network|socket hang up|overloaded|unavailable/i.test(msg)) {
    return true;
  }
  if (e?.name === "AbortError" || e?.code === "ECONNRESET") return true;
  return false;
}

/** Never send a Gemini model id to OpenAI (or vice versa). */
export function modelFitsProvider(provider: LLMProvider, model?: string | null): boolean {
  if (!model?.trim()) return false;
  const m = model.trim().toLowerCase();
  if (provider.models.some((x) => x.toLowerCase() === m)) return true;
  const id = provider.id;
  if (id === "custom") return true; // custom endpoint accepts whatever the org configured
  if (id === "gemini") return m.startsWith("gemini") || m.startsWith("models/gemini");
  if (id === "openai") return /^(gpt-|o[1-9]|chatgpt|text-embedding|ft:)/.test(m);
  if (id === "anthropic") return m.startsWith("claude");
  if (id === "nvidia") return m.includes("/") || m.startsWith("meta") || m.startsWith("nvidia");
  if (id === "kimi") return m.includes("moonshot") || m.includes("kimi");
  if (id === "minimax") return m.toLowerCase().includes("minimax");
  return false;
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
  /** Per-key failures seen by this instance (no key material — provider/source/slot only). */
  failures: { provider: string; source: "org" | "env"; keyIndex: number; status?: number; message: string; at: string }[] = [];
  /** Which entry finally served the call. */
  served: { provider: string; source: "org" | "env"; keyIndex: number; failover: boolean } | null = null;
  private noteFailure(e: ChainEntry, err: unknown) {
    this.failures.push({
      provider: e.provider.id,
      source: e.source,
      keyIndex: e.keyIndex,
      status: (err as { status?: number })?.status,
      message: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    });
  }
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
    const tried = this.chain.map((c) => `${c.provider.id}/${c.source}#${c.keyIndex + 1}`).join(", ");
    const out = new Error(
      `All AI keys failed (${tried}). Last error: ${e?.message ?? String(err)}. Add or check keys in Settings → AI Providers.`,
    ) as Error & { status?: number };
    out.status = e?.status;
    log.error(`All AI keys failed: ${tried}`);
    return out;
  }
  /**
   * Per-entry model: use requested only if it belongs to THIS provider.
   * Failover to OpenAI must never keep a Gemini model id (and vice versa).
   */
  private modelForEntry(_i: number, requested?: string) {
    const e = this.chain[_i];
    if (requested && modelFitsProvider(e.provider, requested)) return requested;
    return e.model; // provider's own default (OPENAI_MODEL / GEMINI_MODEL / …)
  }
  async generateResponse(params: Parameters<LLMProvider["generateResponse"]>[0]) {
    let lastErr: unknown;
    for (let i = 0; i < this.chain.length; i++) {
      const e = this.chain[i];
      this.last = e;
      try {
        const res = await e.provider.generateResponse({ ...params, model: this.modelForEntry(i, params.model) });
        this.served = { provider: e.provider.id, source: e.source, keyIndex: e.keyIndex, failover: i > 0 };
        log.info(
          `AI call served by ${e.provider.id} (${e.source} key #${e.keyIndex + 1})${i > 0 ? " after failover" : ""}`,
        );
        return res;
      } catch (err) {
        lastErr = err;
        this.noteFailure(e, err);
        if (!shouldFailover(err)) throw err;
        if (i === this.chain.length - 1) throw this.allFailed(err);
        log.warn(
          `${e.provider.id} (${e.source} key #${e.keyIndex + 1}) failed (${(err as { status?: number })?.status ?? "err"}) — trying next`,
        );
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
        this.served = { provider: e.provider.id, source: e.source, keyIndex: e.keyIndex, failover: i > 0 };
        return;
      } catch (err) {
        lastErr = err;
        this.noteFailure(e, err);
        // Mid-stream failure after tokens were sent cannot silently switch providers.
        if (yielded || !shouldFailover(err)) throw err;
        if (i === this.chain.length - 1) throw this.allFailed(err);
        log.warn(
          `${e.provider.id} (${e.source} key #${e.keyIndex + 1}) failed (${(err as { status?: number })?.status ?? "err"}) — trying next`,
        );
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
  for (const id of SETTINGS_ORDER) {
    const first = creds[id].apiKeys[0];
    if (!first && id !== "custom") continue;
    const p = providerInstance(id, first || "ollama", creds[id].baseUrl);
    if (p) map.set(id, p);
  }
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
      if (map.has(id) && creds[id].apiKeys.length) return map.get(id)!;
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

function keyOrEmpty(v: string | undefined): string[] {
  return v ? [v] : [];
}

/** Sync env-only resolver (tests / callers without org context). */
export function getProvider(idOrModel?: string | null): LLMProvider {
  const empty = resolveEmptyCreds();
  const map = buildFromCreds(empty);
  return matchProvider(map, idOrModel) ?? pickDefault(map, empty);
}

export function listProviders(): LLMProvider[] {
  return Array.from(buildFromCreds(resolveEmptyCreds()).values());
}

function resolveEmptyCreds(): ResolvedAiCredentials {
  return {
    openai: {
      apiKeys: keyOrEmpty(process.env.OPENAI_API_KEY),
      baseUrl: process.env.OPENAI_BASE_URL,
      from: process.env.OPENAI_API_KEY ? "env" : "none",
    },
    gemini: {
      apiKeys: keyOrEmpty(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      from: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "env" : "none",
    },
    nvidia: {
      apiKeys: keyOrEmpty(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
      baseUrl: "https://integrate.api.nvidia.com/v1",
      from: process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY ? "env" : "none",
    },
    anthropic: {
      apiKeys: keyOrEmpty(process.env.ANTHROPIC_API_KEY),
      from: process.env.ANTHROPIC_API_KEY ? "env" : "none",
    },
    custom: {
      apiKeys: keyOrEmpty(process.env.CUSTOM_LLM_API_KEY || process.env.OPENAI_API_KEY),
      baseUrl: process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
      from: process.env.CUSTOM_LLM_BASE_URL || process.env.CUSTOM_LLM_API_KEY || process.env.OPENAI_API_KEY ? "env" : "none",
    },
  };
}

/** Provider with failover across keys then backup providers for a task. */
export async function resolveProvider(opts?: {
  organizationId?: string | null;
  /** @deprecated Soft hint only — Settings → AI task routing owns order. Kept for API compat. */
  idOrModel?: string | null;
  task?: AiTaskKind;
}): Promise<LLMProvider> {
  const chain = await resolveProviderChain(opts?.organizationId, opts?.task ?? "standard");
  if (!chain.length) {
    throw new Error(
      "No LLM provider configured. Add an API key in Settings → AI Providers, or set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / NVIDIA_API_KEY in .env.",
    );
  }
  // Do NOT reorder by interview.llmProvider — that forced Gemini model ids onto OpenAI after
  // failover/routing. Task priority list in Settings → AI is the source of truth.
  void opts?.idOrModel;
  log.info(
    `AI provider chain task=${opts?.task ?? "standard"}${opts?.organizationId ? ` org=${opts.organizationId.slice(0, 8)}` : ""}: ${chain
      .map((e) => `${e.provider.id}/${e.source}#${e.keyIndex + 1}:${e.model}`)
      .join(" → ")}`,
  );
  return new FailoverProvider(chain);
}

export async function resolveTaskModels(
  organizationId?: string | null,
  task: AiTaskKind = "generate",
): Promise<{
  provider: LLMProvider;
  generatorModel: string;
  reportModel: string;
}> {
  const mapped: AiTaskKind =
    task === "report" ? "report" : task === "resume" ? "resume" : task === "generate" ? "generate" : task;
  const provider = (await resolveProvider({ organizationId, task: mapped })) as FailoverProvider;
  const head = (provider as unknown as { chain: ChainEntry[] }).chain[0].provider;
  return { provider, generatorModel: modelFor(head), reportModel: modelFor(head, "report") };
}

export { DEFAULT_TASK_ROUTING };

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
