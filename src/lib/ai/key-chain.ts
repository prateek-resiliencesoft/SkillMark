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

export function isAuthError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e?.status === 401 || e?.status === 403) return true;
  return /api key not valid|invalid api key|incorrect api key|API_KEY_INVALID|unauthori[sz]ed|permission denied/i.test(
    e?.message ?? "",
  );
}

export const AI_QUOTA_EXHAUSTED = "AI_QUOTA_EXHAUSTED";
export const AI_AUTH_FAILED = "AI_AUTH_FAILED";
export const AI_QUOTA_MESSAGE =
  "AI quota exhausted for all configured keys. Add a key with quota or enable billing in Settings → AI Providers.";
export const AI_AUTH_MESSAGE =
  "AI provider rejected every configured key (invalid, disabled or unauthorized). Check or replace the keys in Settings → AI Providers.";

/**
 * "quota" / "auth" when retrying another attempt cannot help: either a key chain that already
 * walked every key and failed only with quota/auth errors (tagged `code`), or a raw 429/401/403.
 */
export function classifyAiFailure(err: unknown): "quota" | "auth" | null {
  const code = (err as { code?: string } | null)?.code;
  if (code === AI_QUOTA_EXHAUSTED) return "quota";
  if (code === AI_AUTH_FAILED) return "auth";
  if (isQuotaError(err)) return "quota";
  if (isAuthError(err)) return "auth";
  return null;
}

/**
 * Error for an exhausted key chain. When any key hit its quota, say so instead
 * of surfacing whatever the last key happened to fail with (often an unrelated 400).
 * `onlyQuotaOrAuth` = every key failed with quota/auth (nothing a retry could fix): tags `code`.
 */
export function keyChainExhaustedError(
  tried: string,
  lastErr: unknown,
  sawQuota: boolean,
  onlyQuotaOrAuth = false,
): Error & { status?: number; code?: string } {
  const last = lastErr as { status?: number; message?: string };
  const lastMsg = last?.message ?? String(lastErr);
  const out = new Error(
    sawQuota
      ? `AI quota exhausted: every configured key failed and at least one hit its quota / rate limit (${tried}). Wait for the quota to reset or add another key in Settings → AI Providers. Last error: ${lastMsg}`
      : `All AI keys failed (${tried}). Last error: ${lastMsg}. Add or check keys in Settings → AI Providers.`,
  ) as Error & { status?: number; code?: string };
  out.status = sawQuota ? 429 : last?.status;
  if (onlyQuotaOrAuth) out.code = sawQuota ? AI_QUOTA_EXHAUSTED : AI_AUTH_FAILED;
  return out;
}
