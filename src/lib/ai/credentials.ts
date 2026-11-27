if (typeof window !== "undefined") {
  throw new Error("This module cannot be imported from a Client Component module. It should only be used from a Server Component.");
}
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/messaging/secrets";
import type { Context } from "@/server/context";
import { configuredGeminiModel } from "./gemini-models";
import { checkVoiceModel, isVoiceCapableProvider } from "./capabilities";
import { splitKeyList } from "./key-chain";

export const AI_PROVIDER_IDS = ["openai", "gemini", "nvidia", "anthropic", "groq", "custom"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Workload buckets used for provider priority / backup routing. */
export const AI_TASK_KINDS = [
  "screening", // LIGHT follow-ups / simple screens
  "standard", // MODERATE interviews
  "heavy", // DEEP / multi-level rounds
  "interview", // live chat/voice turns (defaults from depth)
  "report", // scoring / summaries
  "resume", // CV parse
  "generate", // question generation
  "voice", // live voice interviews — voice-capable providers only
  "round2_live", // round 2 live copilot: claims, cross-checks, next-question suggestions
  "round2_scoring", // round 2 live rubric score suggestions for the panel
  "round2_report", // round 2 final report after the interview ends
  "round2_transcript", // round 2 speech-to-text (OpenAI-compatible /audio/transcriptions only)
] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

/** Providers with an OpenAI-compatible /audio/transcriptions endpoint (round 2 transcript). */
export const STT_PROVIDER_IDS = ["groq", "openai", "custom"] as const satisfies readonly AiProviderId[];
export function isSttProvider(id: string): boolean {
  return (STT_PROVIDER_IDS as readonly string[]).includes(id);
}

export const MAX_KEYS_PER_PROVIDER = 5;

export type AiKeyTier = "free" | "paid";

/** Align tier list to keyCount; missing/invalid → free. */
export function normalizeKeyTiers(raw: unknown, keyCount: number): AiKeyTier[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: AiKeyTier[] = [];
  for (let i = 0; i < keyCount; i++) {
    out.push(arr[i] === "paid" ? "paid" : "free");
  }
  return out;
}

export type AiProviderStored = {
  /** @deprecated single-key legacy — migrated into apiKeys on read */
  apiKey?: string | null;
  /** Encrypted API keys (max 5). */
  apiKeys?: (string | null)[];
  /** Parallel to apiKeys: free | paid (default free when missing). */
  keyTiers?: AiKeyTier[];
  baseUrl?: string | null;
  /** Custom endpoint only: model for chat/reports/etc. */
  textModel?: string | null;
  /** Custom endpoint only: realtime model for voice interviews (validated). */
  voiceModel?: string | null;
};

export type AiRoutingStored = Partial<Record<AiTaskKind, AiProviderId[]>>;

/** One failover hop: provider + concrete model id for that provider. */
export type AiTaskModelHop = { provider: AiProviderId; model: string };

/** Per-task ordered failover chain with models (Studio). Aligns with `routing` provider order. */
export type AiTaskModelsStored = Partial<Record<AiTaskKind, AiTaskModelHop[]>>;

export type AiProvidersStored = Partial<Record<AiProviderId, AiProviderStored>> & {
  routing?: AiRoutingStored;
  /** Optional per-task model hops; when set, registry prefers hop.model over provider default. */
  taskModels?: AiTaskModelsStored;
};

export type ResolvedProviderCreds = {
  apiKeys: string[];
  baseUrl?: string;
  from: "org" | "env" | "none";
  /** baseUrl came from tenant settings: reach it only through the SSRF-guarded fetch. */
  untrustedBaseUrl?: boolean;
};

export type ResolvedAiCredentials = Record<AiProviderId, ResolvedProviderCreds>;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";

type Db = Context["supabase"];

/** Keys from the first set env var; a value may hold several comma-separated keys. */
export function envKeys(...names: string[]): string[] {
  for (const n of names) {
    const keys = splitKeyList(process.env[n]);
    if (keys.length) return keys;
  }
  return [];
}

function normalizeKeyList(row: AiProviderStored | undefined): string[] {
  if (!row) return [];
  const fromArr = (row.apiKeys ?? [])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean);
  if (fromArr.length) return fromArr.slice(0, MAX_KEYS_PER_PROVIDER);
  if (row.apiKey && String(row.apiKey).trim()) return [String(row.apiKey).trim()];
  return [];
}

/** Decrypt stored org map → plain secrets (never send to client). */
export function decryptAiProviders(raw: unknown): AiProvidersStored {
  const obj = (raw && typeof raw === "object" ? raw : {}) as AiProvidersStored;
  const out: AiProvidersStored = {};
  for (const id of AI_PROVIDER_IDS) {
    const row = obj[id];
    if (!row) continue;
    const encryptedKeys = normalizeKeyList(row);
    const plainKeys = encryptedKeys
      .map((k) => decryptSecret(k) ?? null)
      .filter((k): k is string => !!k);
    out[id] = {
      apiKeys: plainKeys,
      apiKey: plainKeys[0] ?? null,
      keyTiers: normalizeKeyTiers(row.keyTiers, plainKeys.length),
      baseUrl: row.baseUrl?.trim() || null,
      ...(id === "custom"
        ? { textModel: row.textModel?.trim() || null, voiceModel: row.voiceModel?.trim() || null }
        : {}),
    };
  }
  if (obj.routing && typeof obj.routing === "object") {
    out.routing = sanitizeRouting(obj.routing);
  }
  if (obj.taskModels && typeof obj.taskModels === "object") {
    out.taskModels = sanitizeTaskModels(obj.taskModels);
  }
  return out;
}

function sanitizeRouting(raw: AiRoutingStored): AiRoutingStored {
  const out: AiRoutingStored = {};
  for (const kind of AI_TASK_KINDS) {
    const list = raw[kind];
    if (!Array.isArray(list)) continue;
    let cleaned = list.filter((id): id is AiProviderId =>
      (AI_PROVIDER_IDS as readonly string[]).includes(id),
    );
    // Voice interviews: text-only providers never belong here.
    if (kind === "voice") cleaned = cleaned.filter((id) => isVoiceCapableProvider(id));
    if (kind === "round2_transcript") cleaned = cleaned.filter((id) => isSttProvider(id));
    if (cleaned.length) out[kind] = cleaned;
  }
  return out;
}

function hopAllowedForTask(task: AiTaskKind, provider: AiProviderId): boolean {
  if (task === "voice") return isVoiceCapableProvider(provider);
  if (task === "round2_transcript") return isSttProvider(provider);
  return (AI_PROVIDER_IDS as readonly string[]).includes(provider);
}

/** Drop bad hops; trim models; enforce voice/STT provider rules. */
export function sanitizeTaskModels(raw: unknown): AiTaskModelsStored {
  const obj = (raw && typeof raw === "object" ? raw : {}) as AiTaskModelsStored;
  const out: AiTaskModelsStored = {};
  for (const kind of AI_TASK_KINDS) {
    const list = obj[kind];
    if (!Array.isArray(list)) continue;
    const cleaned: AiTaskModelHop[] = [];
    const seen = new Set<string>();
    for (const hop of list) {
      if (!hop || typeof hop !== "object") continue;
      const provider = hop.provider;
      const model = typeof hop.model === "string" ? hop.model.trim() : "";
      if (!(AI_PROVIDER_IDS as readonly string[]).includes(provider)) continue;
      if (!model || !hopAllowedForTask(kind, provider)) continue;
      const key = `${provider}:${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push({ provider, model });
    }
    if (cleaned.length) out[kind] = cleaned;
  }
  return out;
}

/** Derive provider routing lists from taskModels hops (provider order, deduped). */
export function routingFromTaskModels(taskModels: AiTaskModelsStored): AiRoutingStored {
  const out: AiRoutingStored = {};
  for (const kind of AI_TASK_KINDS) {
    const hops = taskModels[kind];
    if (!hops?.length) continue;
    const ids: AiProviderId[] = [];
    for (const h of hops) {
      if (!ids.includes(h.provider)) ids.push(h.provider);
    }
    if (ids.length) out[kind] = ids;
  }
  return sanitizeRouting(out);
}

export function getStoredTaskModels(raw: unknown): AiTaskModelsStored {
  const obj = (raw && typeof raw === "object" ? raw : {}) as AiProvidersStored;
  return sanitizeTaskModels(obj.taskModels ?? {});
}

/** Model string for this task+provider from stored hops (first matching hop). */
export function storedTaskModel(
  taskModels: AiTaskModelsStored | undefined,
  task: AiTaskKind,
  provider: AiProviderId,
): string | null {
  const hops = taskModels?.[task];
  if (!hops?.length) return null;
  const hit = hops.find((h) => h.provider === provider);
  return hit?.model?.trim() || null;
}

/** Masked hints for settings UI (one hint per saved key slot). */
export function maskAiProviders(raw: unknown): Record<
  AiProviderId,
  {
    apiKeyHint: string | null;
    apiKeyHints: (string | null)[];
    baseUrl: string;
    keyCount: number;
    keyTiers: AiKeyTier[];
  }
> {
  const plain = decryptAiProviders(raw);
  const out = {} as Record<
    AiProviderId,
    {
      apiKeyHint: string | null;
      apiKeyHints: (string | null)[];
      baseUrl: string;
      keyCount: number;
      keyTiers: AiKeyTier[];
    }
  >;
  for (const id of AI_PROVIDER_IDS) {
    const keys = plain[id]?.apiKeys ?? [];
    const hints = keys.map((k) => maskSecret(k));
    out[id] = {
      apiKeyHint: hints[0] ?? null,
      apiKeyHints: hints,
      baseUrl: plain[id]?.baseUrl ?? "",
      keyCount: keys.length,
      keyTiers: normalizeKeyTiers(plain[id]?.keyTiers, keys.length),
    };
  }
  return out;
}

export function getStoredRouting(raw: unknown): AiRoutingStored {
  const obj = (raw && typeof raw === "object" ? raw : {}) as AiProvidersStored;
  return sanitizeRouting(obj.routing ?? {});
}

export type ProviderPatch = {
  /** Replace entire key list (plain). Pass [] to clear. Omit to keep. */
  apiKeys?: (string | null)[] | null;
  /** Legacy single-key add/replace first slot. */
  apiKey?: string | null;
  baseUrl?: string | null;
};

/** Merge patch into stored jsonb (encrypt new keys; null clears; undefined keeps). */
export function mergeAiProvidersPatch(
  currentRaw: unknown,
  patch: Partial<Record<AiProviderId, ProviderPatch>>,
  routing?: AiRoutingStored | null,
  taskModels?: AiTaskModelsStored | null,
): AiProvidersStored {
  const current = (
    currentRaw && typeof currentRaw === "object" ? { ...(currentRaw as object) } : {}
  ) as AiProvidersStored;

  for (const id of AI_PROVIDER_IDS) {
    const p = patch[id];
    if (!p) continue;
    const prev = current[id] ?? {};
    const next: AiProviderStored = { ...prev };

    if (p.apiKeys !== undefined) {
      if (p.apiKeys === null || (Array.isArray(p.apiKeys) && p.apiKeys.length === 0)) {
        next.apiKeys = [];
        next.apiKey = null;
        next.keyTiers = [];
      } else {
        const encrypted: string[] = [];
        for (const k of (p.apiKeys ?? []).slice(0, MAX_KEYS_PER_PROVIDER)) {
          const t = typeof k === "string" ? k.trim() : "";
          if (!t) continue;
          // Keep already-encrypted values that look like our cipher, else encrypt plain.
          encrypted.push(t.includes(":") ? t : encryptSecret(t));
        }
        // If client sent empty string slots meaning "keep existing", merge with prev.
        // Simpler contract: apiKeys is full replacement of plain keys from UI.
        next.apiKeys = encrypted;
        next.apiKey = encrypted[0] ?? null;
        next.keyTiers = normalizeKeyTiers(undefined, encrypted.length);
      }
    } else if (p.apiKey !== undefined) {
      if (p.apiKey === null || p.apiKey === "") {
        next.apiKeys = [];
        next.apiKey = null;
        next.keyTiers = [];
      } else {
        const enc = encryptSecret(p.apiKey.trim());
        const existing = normalizeKeyList(prev);
        const prevTiers = normalizeKeyTiers(prev.keyTiers, existing.length);
        // Replace first / set sole key while preserving extras if present.
        const rest = existing.slice(1);
        next.apiKeys = [enc, ...rest].slice(0, MAX_KEYS_PER_PROVIDER);
        next.apiKey = enc;
        const newTiers: AiKeyTier[] = ["free", ...prevTiers.slice(1)];
        next.keyTiers = newTiers.slice(0, next.apiKeys.length);
      }
    }

    if (p.baseUrl !== undefined) {
      next.baseUrl = p.baseUrl?.trim() || null;
    }
    current[id] = next;
  }

  if (routing !== undefined) {
    if (routing === null) {
      delete current.routing;
    } else {
      current.routing = sanitizeRouting(routing);
    }
  }

  if (taskModels !== undefined) {
    if (taskModels === null) {
      delete current.taskModels;
    } else {
      const cleaned = sanitizeTaskModels(taskModels);
      current.taskModels = cleaned;
      // Keep routing aligned with hop provider order when models are saved.
      const derived = routingFromTaskModels(cleaned);
      current.routing = { ...(current.routing ?? {}), ...derived };
    }
  }

  return current;
}

/**
 * Merge UI key edits with existing encrypted slots.
 * `slots[i] = ""` keeps existing key i; non-empty replaces; trailing empties dropped after last set.
 */
export function applyKeySlotsPatch(
  currentRaw: unknown,
  providerId: AiProviderId,
  slots: string[],
  baseUrl?: string | null,
): AiProvidersStored {
  const current = (
    currentRaw && typeof currentRaw === "object" ? { ...(currentRaw as object) } : {}
  ) as AiProvidersStored;
  const prev = current[providerId] ?? {};
  const prevKeys = normalizeKeyList(prev);
  const nextEnc: string[] = [];
  for (let i = 0; i < Math.min(MAX_KEYS_PER_PROVIDER, Math.max(slots.length, prevKeys.length)); i++) {
    const incoming = (slots[i] ?? "").trim();
    if (incoming) {
      nextEnc.push(encryptSecret(incoming));
    } else if (prevKeys[i]) {
      // keep existing encrypted blob as-is
      nextEnc.push(prevKeys[i]);
    }
  }
  // Trim trailing empties that weren't kept
  while (nextEnc.length && !nextEnc[nextEnc.length - 1]) nextEnc.pop();

  const capped = nextEnc.slice(0, MAX_KEYS_PER_PROVIDER);
  current[providerId] = {
    ...prev,
    apiKeys: capped,
    apiKey: capped[0] ?? null,
    keyTiers: normalizeKeyTiers(undefined, capped.length),
    ...(baseUrl !== undefined ? { baseUrl: baseUrl?.trim() || null } : {}),
  };
  return current;
}

/** Save the custom endpoint's models. Voice model must pass the voice check. */
export function applyCustomModelsPatch(
  currentRaw: unknown,
  patch: { textModel?: string | null; voiceModel?: string | null },
): { next: AiProvidersStored; error?: string } {
  const current = (
    currentRaw && typeof currentRaw === "object" ? { ...(currentRaw as object) } : {}
  ) as AiProvidersStored;
  const prev = current.custom ?? {};
  const row: AiProviderStored = { ...prev };
  if (patch.textModel !== undefined) row.textModel = patch.textModel?.trim() || null;
  if (patch.voiceModel !== undefined) {
    const v = patch.voiceModel?.trim() || null;
    if (v) {
      const check = checkVoiceModel(v);
      if (!check.ok) return { next: current, error: check.reason };
    }
    row.voiceModel = v;
  }
  current.custom = row;
  return { next: current };
}

export type KeySlotInput = {
  /** Index of an already-saved key to keep (position in the stored list). */
  keep?: number | null;
  /** New plaintext key; wins over `keep`. */
  value?: string;
  /** Free/Paid account marker; defaults to free. */
  tier?: AiKeyTier;
};

/**
 * Order-aware save: the list order IS the failover order. Saved keys are
 * referenced by their old index so they can be dragged anywhere without
 * ever sending their plaintext back.
 */
export function applyKeyOrderPatch(
  currentRaw: unknown,
  providerId: AiProviderId,
  slots: KeySlotInput[],
  baseUrl?: string | null,
): AiProvidersStored {
  const current = (
    currentRaw && typeof currentRaw === "object" ? { ...(currentRaw as object) } : {}
  ) as AiProvidersStored;
  const prev = current[providerId] ?? {};
  const prevKeys = normalizeKeyList(prev);
  const prevTiers = normalizeKeyTiers(prev.keyTiers, prevKeys.length);
  const used = new Set<number>();
  const nextEnc: string[] = [];
  const nextTiers: AiKeyTier[] = [];
  for (const slot of slots) {
    const incoming = (slot.value ?? "").trim();
    if (incoming) {
      nextEnc.push(encryptSecret(incoming));
      nextTiers.push(slot.tier === "paid" ? "paid" : "free");
    } else if (slot.keep != null && prevKeys[slot.keep] && !used.has(slot.keep)) {
      used.add(slot.keep);
      nextEnc.push(prevKeys[slot.keep]);
      nextTiers.push(
        slot.tier === "paid" || slot.tier === "free" ? slot.tier : prevTiers[slot.keep],
      );
    }
  }
  const capped = nextEnc.slice(0, MAX_KEYS_PER_PROVIDER);
  current[providerId] = {
    ...prev,
    apiKeys: capped,
    apiKey: capped[0] ?? null,
    keyTiers: nextTiers.slice(0, capped.length),
    ...(baseUrl !== undefined ? { baseUrl: baseUrl?.trim() || null } : {}),
  };
  return current;
}

/**
 * Platform env keys are only ever paired with platform-controlled base URLs. Built-in
 * providers ignore any stored org baseUrl; the custom provider's org baseUrl is used
 * with org keys (or a dummy placeholder) and is flagged untrusted.
 */
export function resolveCredentials(orgPlain: AiProvidersStored): ResolvedAiCredentials {
  const pick = (
    orgKeys: string[],
    envNames: string[],
    envBase?: string,
    defaultBase?: string,
  ): ResolvedProviderCreds => {
    const baseUrl = envBase || defaultBase;
    if (orgKeys.length) return { apiKeys: orgKeys, baseUrl, from: "org" };
    const ek = envKeys(...envNames);
    if (ek.length) return { apiKeys: ek, baseUrl, from: "env" };
    return { apiKeys: [], baseUrl, from: "none" };
  };

  const keysOf = (id: AiProviderId): string[] =>
    (orgPlain[id]?.apiKeys ?? []).filter((k): k is string => typeof k === "string" && !!k.trim());

  const customKeys = keysOf("custom");
  const customOrgBase = orgPlain.custom?.baseUrl?.trim() || null;
  const customEnvBase = process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL;
  let customResolved: ResolvedProviderCreds;
  if (customOrgBase) {
    customResolved = {
      apiKeys: customKeys.length ? customKeys : ["ollama"],
      baseUrl: customOrgBase,
      from: "org",
      untrustedBaseUrl: true,
    };
  } else if (customKeys.length) {
    customResolved = { apiKeys: customKeys, baseUrl: customEnvBase, from: "org" };
  } else {
    customResolved = pick([], ["CUSTOM_LLM_API_KEY", "OPENAI_API_KEY"], customEnvBase);
  }

  return {
    openai: pick(keysOf("openai"), ["OPENAI_API_KEY"], process.env.OPENAI_BASE_URL),
    gemini: pick(keysOf("gemini"), ["GEMINI_API_KEY", "GOOGLE_API_KEY"], undefined, GEMINI_BASE),
    nvidia: pick(keysOf("nvidia"), ["NVIDIA_API_KEY", "NGC_API_KEY"], undefined, NVIDIA_BASE),
    anthropic: pick(keysOf("anthropic"), ["ANTHROPIC_API_KEY"]),
    groq: pick(keysOf("groq"), ["GROQ_API_KEY"], process.env.GROQ_BASE_URL, GROQ_BASE),
    custom: customResolved,
  };
}

/** Default provider priority when org has not set routing for a task. */
/**
 * Platform default order from env, e.g. AI_ROUTING_ROUND2_LIVE="groq,gemini,openai".
 * Unknown ids are dropped; an empty result falls back to the built-in order.
 */
export function envTaskRouting(task: AiTaskKind, fallback: AiProviderId[], env: Record<string, string | undefined> = process.env): AiProviderId[] {
  const raw = env[`AI_ROUTING_${task.toUpperCase()}`];
  if (!raw?.trim()) return fallback;
  const ids = Array.from(
    new Set(
      raw
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter((x): x is AiProviderId => (AI_PROVIDER_IDS as readonly string[]).includes(x)),
    ),
  ).filter((id) => task !== "round2_transcript" || isSttProvider(id));
  return ids.length ? ids : fallback;
}

/**
 * Per-task model override for one provider, e.g. AI_MODEL_ROUND2_LIVE_GROQ=llama-3.3-70b-versatile
 * or AI_MODEL_ROUND2_TRANSCRIPT_GROQ=whisper-large-v3. Empty → the provider's normal model.
 */
export function taskModelOverride(task: AiTaskKind, id: string, env: Record<string, string | undefined> = process.env): string | null {
  const v = env[`AI_MODEL_${task.toUpperCase()}_${id.toUpperCase()}`]?.trim();
  return v || null;
}

export const DEFAULT_TASK_ROUTING: Record<AiTaskKind, AiProviderId[]> = {
  screening: ["gemini", "openai", "anthropic", "groq", "nvidia", "custom"],
  standard: ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"],
  heavy: ["openai", "anthropic", "gemini", "groq", "nvidia", "custom"],
  interview: ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"],
  report: ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"],
  resume: ["gemini", "openai", "anthropic", "groq", "nvidia", "custom"],
  generate: ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"],
  voice: ["openai", "gemini"],
  round2_live: envTaskRouting("round2_live", ["openai", "gemini", "groq", "anthropic", "nvidia", "custom"]),
  round2_scoring: envTaskRouting("round2_scoring", ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"]),
  round2_report: envTaskRouting("round2_report", ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"]),
  round2_transcript: envTaskRouting("round2_transcript", ["groq", "openai", "custom"]),
};

/** Per-provider chat model (env override). Failover always swaps to this provider's model — never reuses another vendor's id. */
export function defaultModelForProvider(id: AiProviderId): string {
  switch (id) {
    case "openai":
      return process.env.OPENAI_MODEL || "gpt-4o-mini";
    case "gemini":
      return configuredGeminiModel();
    case "nvidia":
      return process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    case "groq":
      return process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    case "custom":
      return process.env.CUSTOM_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  }
}

export const DEFAULT_PROVIDER_MODELS: Record<AiProviderId, string> = {
  openai: defaultModelForProvider("openai"),
  gemini: defaultModelForProvider("gemini"),
  nvidia: defaultModelForProvider("nvidia"),
  anthropic: defaultModelForProvider("anthropic"),
  groq: defaultModelForProvider("groq"),
  custom: defaultModelForProvider("custom"),
};

export function routingForTask(
  stored: AiRoutingStored | undefined,
  task: AiTaskKind,
  taskModels?: AiTaskModelsStored,
): AiProviderId[] {
  const fromHops = taskModels?.[task]?.map((h) => h.provider).filter(Boolean);
  if (fromHops?.length) {
    // Preserve hop order; dedupe providers.
    return Array.from(new Set(fromHops));
  }
  const custom = stored?.[task];
  if (custom?.length) return custom;
  return DEFAULT_TASK_ROUTING[task];
}

/** Map interview follow-up depth → routing task. */
export function taskFromFollowUpDepth(depth?: string | null): AiTaskKind {
  if (depth === "LIGHT") return "screening";
  if (depth === "DEEP") return "heavy";
  return "standard";
}

export async function loadOrgAiCredentials(
  supabase: Db,
  organizationId?: string | null,
): Promise<ResolvedAiCredentials> {
  let orgPlain: AiProvidersStored = {};
  if (organizationId) {
    const { data } = await supabase
      .from("org_integrations")
      .select("aiProviders")
      .eq("organizationId", organizationId)
      .maybeSingle();
    orgPlain = decryptAiProviders(data?.aiProviders);
  }
  return resolveCredentials(orgPlain);
}

export async function loadOrgAiProvidersRaw(supabase: Db, organizationId: string) {
  const { data } = await supabase
    .from("org_integrations")
    .select("aiProviders")
    .eq("organizationId", organizationId)
    .maybeSingle();
  return data?.aiProviders ?? {};
}

export async function loadOrgAiBundle(supabase: Db, organizationId?: string | null) {
  let orgPlain: AiProvidersStored = {};
  if (organizationId) {
    const { data } = await supabase
      .from("org_integrations")
      .select("aiProviders")
      .eq("organizationId", organizationId)
      .maybeSingle();
    orgPlain = decryptAiProviders(data?.aiProviders);
  }
  return {
    creds: resolveCredentials(orgPlain),
    routing: orgPlain.routing ?? {},
    plain: orgPlain,
  };
}
