import type { AiProviderId } from "./credentials";

export type ListedModel = { id: string; displayName?: string };

/**
 * Best-effort live model list for a provider key.
 * OpenAI-compatible providers use GET {base}/models.
 */
export async function listProviderModels(opts: {
  provider: AiProviderId;
  apiKey: string;
  baseUrl?: string | null;
}): Promise<ListedModel[]> {
  const { provider, apiKey } = opts;
  if (!apiKey?.trim()) return [];

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) throw new Error(`Anthropic models HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { id?: string; display_name?: string }[] };
    return (body.data ?? [])
      .map((m) => ({ id: m.id ?? "", displayName: m.display_name }))
      .filter((m) => m.id);
  }

  const base =
    opts.baseUrl?.replace(/\/+$/, "") ||
    (provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta/openai"
      : provider === "groq"
        ? "https://api.groq.com/openai/v1"
        : provider === "nvidia"
          ? "https://integrate.api.nvidia.com/v1"
          : "https://api.openai.com/v1");

  const url = `${base}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`${provider} models HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? [])
    .map((m) => ({ id: (m.id ?? "").replace(/^models\//, ""), displayName: m.id }))
    .filter((m) => m.id);
}
