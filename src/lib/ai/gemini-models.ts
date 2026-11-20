/**
 * Gemini model ids (pure, no I/O).
 *
 * Google retires Flash ids every few months and routes the old id to its
 * replacement, which then applies the newer model's request rules. Keep the
 * default on a current GA id and map known retired ids so a stale GEMINI_MODEL
 * in .env keeps working.
 */

/** Current GA Flash model used when nothing is configured. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/** Tried in order (same key) when Google rejects the model id itself. */
export const GEMINI_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"] as const;

/** Deprecated id → the replacement Google documents for it. */
const RETIRED_GEMINI_MODELS: Record<string, string> = {
  "gemini-3.5-flash": "gemini-3.6-flash",
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.8-flash",
  "gemini-2.0-flash": "gemini-3.5-flash-lite",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite",
};

/** `models/gemini-3.5-flash` / `gemini-3.5-flash` → current replacement; unknown ids pass through. */
export function normalizeGeminiModel(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return DEFAULT_GEMINI_MODEL;
  const bare = raw.replace(/^models\//, "");
  return RETIRED_GEMINI_MODELS[bare.toLowerCase()] ?? bare;
}

/** GEMINI_MODEL (normalized) or the default. */
export function configuredGeminiModel(envValue = process.env.GEMINI_MODEL): string {
  return normalizeGeminiModel(envValue);
}

/** Requested model first, then the fallbacks, no duplicates. */
export function geminiModelChain(requested: string | null | undefined): string[] {
  return Array.from(new Set([normalizeGeminiModel(requested), ...GEMINI_FALLBACK_MODELS]));
}

/**
 * Gemini 3.6+ ignores temperature/top_p/top_k (deprecated, 400 in future
 * generations). Only send temperature to models that still use it.
 */
export function geminiAcceptsTemperature(model: string): boolean {
  const m = /^gemini-(\d+)(?:\.(\d+))?/i.exec(model.replace(/^models\//, ""));
  if (!m) return true;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major < 3 || (major === 3 && minor < 6);
}

/**
 * Gemini's OpenAI-compatible endpoint wraps errors in an array:
 * `[{"error":{"code":400,"message":"…","status":"FAILED_PRECONDITION"}}]`.
 * The OpenAI SDK reads `body.error`, finds nothing and reports
 * "400 status code (no body)", hiding the real reason. Unwrap it.
 */
export function unwrapGeminiErrorBody(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed) && parsed.length && parsed[0] && typeof parsed[0] === "object" && "error" in parsed[0]) {
      return JSON.stringify(parsed[0]);
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Google error status (INVALID_ARGUMENT, FAILED_PRECONDITION, NOT_FOUND …) from an SDK error, if any. */
export function googleErrorStatus(err: unknown): string | null {
  const e = err as { error?: { status?: unknown }; message?: string } | null;
  const s = e?.error?.status;
  if (typeof s === "string" && s) return s;
  const m = /\b(INVALID_ARGUMENT|FAILED_PRECONDITION|NOT_FOUND|PERMISSION_DENIED|RESOURCE_EXHAUSTED|UNAUTHENTICATED)\b/.exec(
    e?.message ?? "",
  );
  return m ? m[1] : null;
}

/**
 * The model id itself was refused (unknown / retired / not supported for this
 * method) — worth retrying the same key with another model. Billing, region
 * and key problems are not: another model id fails the same way.
 */
export function isModelRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  const status = e?.status;
  const text = `${e?.error?.message ?? ""} ${e?.message ?? ""}`;
  if (/API_KEY|api key|billing|free tier|location is not supported|FAILED_PRECONDITION|PERMISSION_DENIED/i.test(text)) {
    return false;
  }
  if (status === 404 || status === 410) return true;
  if (status !== 400) return false;
  // "no body" = the reason was lost; another model is a cheap second try.
  return /\bmodel\b|models\/|not (found|supported)|unsupported|is not available|unknown name|invalid argument|INVALID_ARGUMENT|no body/i.test(
    text,
  );
}
