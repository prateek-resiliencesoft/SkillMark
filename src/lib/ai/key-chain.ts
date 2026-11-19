/**
 * Pure helpers shared by the AI provider chain and the voice relays (no DB / secrets imports).
 */

/** `"k1, k2,k1"` → `["k1", "k2"]`: env vars may hold several comma-separated keys. */
export function splitKeyList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map((k) => k.trim()).filter(Boolean)));
}

export function isQuotaError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; code?: string };
  if (e?.status === 429) return true;
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(e?.message ?? "");
}

/**
 * Error for an exhausted key chain. When any key hit its quota, say so instead
 * of surfacing whatever the last key happened to fail with (often an unrelated 400).
 */
export function keyChainExhaustedError(tried: string, lastErr: unknown, sawQuota: boolean): Error & { status?: number } {
  const last = lastErr as { status?: number; message?: string };
  const lastMsg = last?.message ?? String(lastErr);
  const out = new Error(
    sawQuota
      ? `AI quota exhausted: every configured key failed and at least one hit its quota / rate limit (${tried}). Wait for the quota to reset or add another key in Settings → AI Providers. Last error: ${lastMsg}`
      : `All AI keys failed (${tried}). Last error: ${lastMsg}. Add or check keys in Settings → AI Providers.`,
  ) as Error & { status?: number };
  out.status = sawQuota ? 429 : last?.status;
  return out;
}
