/**
 * Pure helpers for AI routes that sit behind a proxy with a hard response timeout:
 * a total time budget (AbortSignal) and one mapping from AI failures to a clear JSON error.
 */
import { AI_AUTH_MESSAGE, AI_QUOTA_MESSAGE, classifyAiFailure } from "./key-chain";

/** Proxy (Caddy) answers an empty 504 at 90s; stay well under it. */
export const PARSE_CV_BUDGET_MS = 75_000;
/** Cap for one vision / chat call so a single hung provider cannot eat the whole budget. */
export const AI_CALL_TIMEOUT_MS = 40_000;

/** Vision (scanned PDF / image → Markdown) is slower than a text call. */
export const VISION_CALL_TIMEOUT_MS = 45_000;

export const TIMEOUT_MESSAGE =
  "The server took too long to process the CVs. Please try again with fewer files.";

/** Aborts after `ms`, or as soon as `parent` (e.g. the client disconnecting) aborts. */
export function budgetSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, t]) : t;
}

export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string } | null;
  return (
    e?.name === "AbortError" ||
    e?.name === "TimeoutError" ||
    e?.name === "APIUserAbortError" ||
    e?.code === "ABORT_ERR" ||
    /request was aborted|operation was aborted|timed out|apiuserabort/i.test(e?.message ?? "")
  );
}

export interface AiErrorInfo {
  status: number;
  error: string;
  code: "AI_QUOTA_EXHAUSTED" | "AI_AUTH_FAILED" | "TIMEOUT";
}

/** Timeout → 504, quota → 429, auth → 503 (server config). null = not one of these; caller decides. */
export function describeAiFailure(err: unknown, signal?: AbortSignal): AiErrorInfo | null {
  const kind = classifyAiFailure(err);
  if (kind === "quota") return { status: 429, error: AI_QUOTA_MESSAGE, code: "AI_QUOTA_EXHAUSTED" };
  if (kind === "auth") return { status: 503, error: AI_AUTH_MESSAGE, code: "AI_AUTH_FAILED" };
  if (signal?.aborted || isAbortError(err)) return { status: 504, error: TIMEOUT_MESSAGE, code: "TIMEOUT" };
  return null;
}

/** Settles with `work`, or rejects with the abort reason the moment `signal` fires (even if `work` ignores it). */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
