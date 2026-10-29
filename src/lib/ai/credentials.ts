if (typeof window !== "undefined") {
  throw new Error("This module cannot be imported from a Client Component module. It should only be used from a Server Component.");
}
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/messaging/secrets";
import type { Context } from "@/server/context";

export const AI_PROVIDER_IDS = ["openai", "gemini", "nvidia", "anthropic", "custom"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderStored = {
  apiKey?: string | null;
  baseUrl?: string | null;
};

export type AiProvidersStored = Partial<Record<AiProviderId, AiProviderStored>>;

export type ResolvedAiCredentials = Record<
  AiProviderId,
  { apiKey: string; baseUrl?: string; from: "org" | "env" | "none" }
>;

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

/** Decrypt stored org map → plain secrets (never send to client). */
export function decryptAiProviders(raw: unknown): AiProvidersStored {
  const obj = (raw && typeof raw === "object" ? raw : {}) as AiProvidersStored;
  const out: AiProvidersStored = {};
  for (const id of AI_PROVIDER_IDS) {
    const row = obj[id];
    if (!row) continue;
    out[id] = {
      apiKey: decryptSecret(row.apiKey) ?? null,
      baseUrl: row.baseUrl?.trim() || null,
    };
  }
  return out;
}

/** Masked hints for settings UI. */
export function maskAiProviders(raw: unknown): Record<AiProviderId, { apiKeyHint: string | null; baseUrl: string }> {
  const plain = decryptAiProviders(raw);
  const out = {} as Record<AiProviderId, { apiKeyHint: string | null; baseUrl: string }>;
  for (const id of AI_PROVIDER_IDS) {
    out[id] = {
      apiKeyHint: maskSecret(plain[id]?.apiKey),
      baseUrl: plain[id]?.baseUrl ?? "",
    };
  }
  return out;
}

/** Merge patch into stored jsonb (encrypt new keys; null clears; undefined keeps). */
export function mergeAiProvidersPatch(
  currentRaw: unknown,
  patch: Partial<Record<AiProviderId, { apiKey?: string | null; baseUrl?: string | null }>>,
): AiProvidersStored {
  const current = (currentRaw && typeof currentRaw === "object" ? { ...(currentRaw as object) } : {}) as AiProvidersStored;
  for (const id of AI_PROVIDER_IDS) {
    const p = patch[id];
    if (!p) continue;
    const prev = current[id] ?? {};
    const next: AiProviderStored = { ...prev };
    if (p.apiKey !== undefined) {
      next.apiKey = p.apiKey ? encryptSecret(p.apiKey.trim()) : null;
    }
    if (p.baseUrl !== undefined) {
      next.baseUrl = p.baseUrl?.trim() || null;
    }
    current[id] = next;
  }
  return current;
}

export function resolveCredentials(orgPlain: AiProvidersStored): ResolvedAiCredentials {
  const pick = (
    id: AiProviderId,
    orgKey: string | null | undefined,
    orgBase: string | null | undefined,
    envKeys: string[],
    envBase?: string,
    defaultBase?: string,
  ): ResolvedAiCredentials[AiProviderId] => {
    if (orgKey) {
      return {
        apiKey: orgKey,
        baseUrl: orgBase || envBase || defaultBase,
        from: "org",
      };
    }
    const ek = envKey(...envKeys);
    if (ek) {
      return {
        apiKey: ek,
        baseUrl: orgBase || envBase || defaultBase,
        from: "env",
      };
    }
    return { apiKey: "", baseUrl: orgBase || envBase || defaultBase, from: "none" };
  };

  const customOrgKey = orgPlain.custom?.apiKey;
  const customOrgBase = orgPlain.custom?.baseUrl;
  // Local endpoints often need only a base URL (e.g. Ollama).
  const customResolved =
    customOrgKey || customOrgBase
      ? ({
          apiKey: customOrgKey || envKey("CUSTOM_LLM_API_KEY", "OPENAI_API_KEY") || "ollama",
          baseUrl: customOrgBase || process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
          from: "org" as const,
        } satisfies ResolvedAiCredentials["custom"])
      : pick(
          "custom",
          null,
          null,
          ["CUSTOM_LLM_API_KEY", "OPENAI_API_KEY"],
          process.env.CUSTOM_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
        );

  return {
    openai: pick(
      "openai",
      orgPlain.openai?.apiKey,
      orgPlain.openai?.baseUrl,
      ["OPENAI_API_KEY"],
      process.env.OPENAI_BASE_URL,
    ),
    gemini: pick(
      "gemini",
      orgPlain.gemini?.apiKey,
      orgPlain.gemini?.baseUrl,
      ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      undefined,
      GEMINI_BASE,
    ),
    nvidia: pick(
      "nvidia",
      orgPlain.nvidia?.apiKey,
      orgPlain.nvidia?.baseUrl,
      ["NVIDIA_API_KEY", "NGC_API_KEY"],
      undefined,
      NVIDIA_BASE,
    ),
    anthropic: pick(
      "anthropic",
      orgPlain.anthropic?.apiKey,
      orgPlain.anthropic?.baseUrl,
      ["ANTHROPIC_API_KEY"],
    ),
    custom: customResolved,
  };
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
