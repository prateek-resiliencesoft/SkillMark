if (typeof window !== "undefined") {
  throw new Error("This module cannot be imported from a Client Component module. It should only be used from a Server Component.");
}
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/messaging/secrets";
import type { Context } from "@/server/context";

export const AI_PROVIDER_IDS = ["openai", "gemini", "nvidia", "anthropic", "custom"] as const;
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
] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

export const MAX_KEYS_PER_PROVIDER = 5;

export type AiProviderStored = {
  /** @deprecated single-key legacy — migrated into apiKeys on read */
  apiKey?: string | null;
  /** Encrypted API keys (max 5). */
  apiKeys?: (string | null)[];
  baseUrl?: string | null;
};

export type AiRoutingStored = Partial<Record<AiTaskKind, AiProviderId[]>>;

export type AiProvidersStored = Partial<Record<AiProviderId, AiProviderStored>> & {
  routing?: AiRoutingStored;
};

export type ResolvedProviderCreds = {
  apiKeys: string[];
  baseUrl?: string;
  from: "org" | "env" | "none";
};

export type ResolvedAiCredentials = Record<AiProviderId, ResolvedProviderCreds>;

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

type Db = Context["supabase"];

function envKey(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return "";
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
      baseUrl: row.baseUrl?.trim() || null,
    };
  }
  if (obj.routing && typeof obj.routing === "object") {
    out.routing = sanitizeRouting(obj.routing);
  }
  return out;
}

function sanitizeRouting(raw: AiRoutingStored): AiRoutingStored {
  const out: AiRoutingStored = {};
  for (const kind of AI_TASK_KINDS) {
    const list = raw[kind];
    if (!Array.isArray(list)) continue;
    const cleaned = list.filter((id): id is AiProviderId =>
      (AI_PROVIDER_IDS as readonly string[]).includes(id),
    );
    if (cleaned.length) out[kind] = cleaned;
  }
  return out;
}

/** Masked hints for settings UI (one hint per saved key slot). */
export function maskAiProviders(raw: unknown): Record<
  AiProviderId,
  { apiKeyHint: string | null; apiKeyHints: (string | null)[]; baseUrl: string; keyCount: number }
> {
  const plain = decryptAiProviders(raw);
  const out = {} as Record<
    AiProviderId,
    { apiKeyHint: string | null; apiKeyHints: (string | null)[]; baseUrl: string; keyCount: number }
  >;
  for (const id of AI_PROVIDER_IDS) {
    const keys = plain[id]?.apiKeys ?? [];
    const hints = keys.map((k) => maskSecret(k));
    out[id] = {
      apiKeyHint: hints[0] ?? null,
      apiKeyHints: hints,
      baseUrl: plain[id]?.baseUrl ?? "",
      keyCount: keys.length,
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
      }
    } else if (p.apiKey !== undefined) {
      if (p.apiKey === null || p.apiKey === "") {
        next.apiKeys = [];
        next.apiKey = null;
      } else {
        const enc = encryptSecret(p.apiKey.trim());
        const existing = normalizeKeyList(prev);
        // Replace first / set sole key while preserving extras if present.
        const rest = existing.slice(1);
        next.apiKeys = [enc, ...rest].slice(0, MAX_KEYS_PER_PROVIDER);
        next.apiKey = enc;
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

  current[providerId] = {
    ...prev,
    apiKeys: nextEnc.slice(0, MAX_KEYS_PER_PROVIDER),
    apiKey: nextEnc[0] ?? null,
    ...(baseUrl !== undefined ? { baseUrl: baseUrl?.trim() || null } : {}),
  };
  return current;
}

export function resolveCredentials(orgPlain: AiProvidersStored): ResolvedAiCredentials {
  const pick = (
    orgKeys: string[],
    orgBase: string | null | undefined,
    envKeys: string[],
    envBase?: string,
    defaultBase?: string,
  ): ResolvedProviderCreds => {
    if (orgKeys.length) {
      return {
        apiKeys: orgKeys,
        baseUrl: orgBase || envBase || defaultBase,
        from: "org",
      };
    }
    const ek = envKey(...envKeys);
    if (ek) {
      return {
        apiKeys: [ek],
        baseUrl: orgBase || envBase || defaultBase,
        from: "env",
      };
    }
    return { apiKeys: [], baseUrl: orgBase || envBase || defaultBase, from: "none" };
  };

  const keysOf = (id: AiProviderId): string[] =>
    (orgPlain[id]?.apiKeys ?? []).filter((k): k is string => typeof k === "string" && !!k.trim());

  const customKeys = keysOf("custom");
  const customOrgBase = orgPlain.custom?.baseUrl;
  const customResolved: ResolvedProviderCreds =
    customKeys.length || customOrgBase
      ? {
          apiKeys: customKeys.length
            ? customKeys
            : [envKey("CUSTOM_LLM_API_KEY", "OPENAI_API_KEY") || "ollama"],
          baseUrl: customOrgBase || process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
          from: "org",
        }
      : pick(
          [],
          null,
          ["CUSTOM_LLM_API_KEY", "OPENAI_API_KEY"],
          process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
        );

  return {
    openai: pick(keysOf("openai"), orgPlain.openai?.baseUrl, ["OPENAI_API_KEY"], process.env.OPENAI_BASE_URL),
    gemini: pick(keysOf("gemini"), orgPlain.gemini?.baseUrl, ["GEMINI_API_KEY", "GOOGLE_API_KEY"], undefined, GEMINI_BASE),
    nvidia: pick(keysOf("nvidia"), orgPlain.nvidia?.baseUrl, ["NVIDIA_API_KEY", "NGC_API_KEY"], undefined, NVIDIA_BASE),
    anthropic: pick(keysOf("anthropic"), orgPlain.anthropic?.baseUrl, ["ANTHROPIC_API_KEY"]),
    custom: customResolved,
  };
}

/** Default provider priority when org has not set routing for a task. */
export const DEFAULT_TASK_ROUTING: Record<AiTaskKind, AiProviderId[]> = {
  screening: ["gemini", "openai", "anthropic", "nvidia", "custom"],
  standard: ["openai", "gemini", "anthropic", "nvidia", "custom"],
  heavy: ["openai", "anthropic", "gemini", "nvidia", "custom"],
  interview: ["openai", "gemini", "anthropic", "nvidia", "custom"],
  report: ["openai", "gemini", "anthropic", "nvidia", "custom"],
  resume: ["gemini", "openai", "anthropic", "nvidia", "custom"],
  generate: ["openai", "gemini", "anthropic", "nvidia", "custom"],
};

/** Per-provider chat model (env override). Failover always swaps to this provider's model — never reuses another vendor's id. */
export function defaultModelForProvider(id: AiProviderId): string {
  switch (id) {
    case "openai":
      return process.env.OPENAI_MODEL || "gpt-4o-mini";
    case "gemini":
      return process.env.GEMINI_MODEL || "gemini-3.5-flash";
    case "nvidia":
      return process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    case "custom":
      return process.env.CUSTOM_LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  }
}

export const DEFAULT_PROVIDER_MODELS: Record<AiProviderId, string> = {
  openai: defaultModelForProvider("openai"),
  gemini: defaultModelForProvider("gemini"),
  nvidia: defaultModelForProvider("nvidia"),
  anthropic: defaultModelForProvider("anthropic"),
  custom: defaultModelForProvider("custom"),
};

export function routingForTask(stored: AiRoutingStored | undefined, task: AiTaskKind): AiProviderId[] {
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
