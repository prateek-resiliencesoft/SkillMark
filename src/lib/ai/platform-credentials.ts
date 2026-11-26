import "server-only";
import {
  AI_PROVIDER_IDS,
  AI_TASK_KINDS,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_TASK_ROUTING,
  MAX_KEYS_PER_PROVIDER,
  applyKeySlotsPatch,
  decryptAiProviders,
  defaultModelForProvider,
  getStoredRouting,
  maskAiProviders,
  mergeAiProvidersPatch,
  type AiProviderId,
  type AiProvidersStored,
} from "@/lib/ai/credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TABLE = "platform_ai_providers";

export class PlatformAiTableMissingError extends Error {
  constructor() {
    super("platform_ai_providers table missing");
    this.name = "PlatformAiTableMissingError";
  }
}

export async function loadPlatformAiProvidersRaw(): Promise<AiProvidersStored> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("aiProviders").eq("id", 1).maybeSingle();
  if (error) {
    if (error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "")) {
      throw new PlatformAiTableMissingError();
    }
    throw error;
  }
  return (data?.aiProviders as AiProvidersStored) ?? {};
}

export async function savePlatformAiProvidersRaw(next: AiProvidersStored): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    { id: 1, aiProviders: next, updatedAt: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) throw error;
}

export async function loadPlatformAiPlain(): Promise<AiProvidersStored> {
  return decryptAiProviders(await loadPlatformAiProvidersRaw());
}

function envFallbackFlags() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    nvidia: !!(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    custom: !!(process.env.CUSTOM_LLM_BASE_URL || process.env.CUSTOM_LLM_API_KEY),
  };
}

export async function getPlatformAiSettingsView() {
  try {
    const raw = await loadPlatformAiProvidersRaw();
    const masked = maskAiProviders(raw);
    const plain = decryptAiProviders(raw);
    const storedRouting = getStoredRouting(raw);
    const routing = Object.fromEntries(
      AI_TASK_KINDS.map((kind) => [kind, storedRouting[kind] ?? DEFAULT_TASK_ROUTING[kind]]),
    );

    return {
      providers: AI_PROVIDER_IDS.map((id) => ({
        id,
        apiKeyHint: masked[id].apiKeyHint,
        apiKeyHints: masked[id].apiKeyHints,
        keyCount: masked[id].keyCount,
        keyTiers: masked[id].keyTiers,
        maxKeys: MAX_KEYS_PER_PROVIDER,
        baseUrl: id === "custom" ? masked[id].baseUrl : undefined,
        textModel: id === "custom" ? plain.custom?.textModel ?? "" : undefined,
        voiceModel: id === "custom" ? plain.custom?.voiceModel ?? "" : undefined,
        defaultModel: defaultModelForProvider(id),
        configured: masked[id].keyCount > 0 || (id === "custom" && !!masked[id].baseUrl),
      })),
      routing,
      defaultRouting: DEFAULT_TASK_ROUTING,
      defaultModels: DEFAULT_PROVIDER_MODELS,
      taskKinds: AI_TASK_KINDS,
      envFallback: envFallbackFlags(),
      available: true as const,
    };
  } catch (err) {
    if (err instanceof PlatformAiTableMissingError) {
      return {
        providers: [] as const,
        envFallback: envFallbackFlags(),
        available: false as const,
      };
    }
    throw err;
  }
}

export async function savePlatformProviderKeys(opts: {
  providerId: AiProviderId;
  keySlots: string[];
  baseUrl?: string | null;
}): Promise<void> {
  const current = await loadPlatformAiProvidersRaw();
  const next = applyKeySlotsPatch(current, opts.providerId, opts.keySlots, opts.baseUrl);
  await savePlatformAiProvidersRaw(next);
}

export async function clearPlatformProvider(providerId: AiProviderId): Promise<void> {
  const current = await loadPlatformAiProvidersRaw();
  const next = mergeAiProvidersPatch(current, {
    [providerId]: { apiKeys: [], baseUrl: providerId === "custom" ? null : undefined },
  });
  await savePlatformAiProvidersRaw(next);
}
