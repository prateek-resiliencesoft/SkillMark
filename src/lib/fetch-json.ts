/**
 * Safe `fetch → JSON` for client code. A proxy (Caddy 502/504) or a crashed route answers with an
 * empty or HTML body, and a bare `res.json()` then throws "Unexpected end of JSON input".
 * Read the text first, parse defensively, and always surface a readable message.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ReadOptions {
  /** Shown for 502/504/408 (proxy gave up). */
  timeoutMessage?: string;
}

const DEFAULT_TIMEOUT_MESSAGE = "The server took too long to respond. Please try again.";

function tryParse(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorOf(data: unknown): { error?: string; code?: string } {
  if (!data || typeof data !== "object") return {};
  const d = data as { error?: unknown; message?: unknown; code?: unknown };
  const error = typeof d.error === "string" ? d.error : typeof d.message === "string" ? d.message : undefined;
  return { error: error?.trim() || undefined, code: typeof d.code === "string" ? d.code : undefined };
}

function messageFor(status: number, serverError: string | undefined, opts: ReadOptions): string {
  if (serverError) return serverError;
  if (status === 408 || status === 502 || status === 504) return opts.timeoutMessage ?? DEFAULT_TIMEOUT_MESSAGE;
  if (status === 503) return "The service is temporarily unavailable. Please try again shortly.";
  if (status === 413) return "The upload is too large.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  return `Request failed (HTTP ${status}). Please try again.`;
}

/** Readable message for a non-OK response (empty / HTML / JSON body all handled). Never throws. */
export async function responseErrorMessage(res: Response, opts: ReadOptions = {}): Promise<string> {
  const text = await res.text().catch(() => "");
  return messageFor(res.status, errorOf(tryParse(text)).error, opts);
}

/** Parses a JSON response; throws an `HttpError` with a readable message for non-OK or non-JSON bodies. */
export async function readJsonResponse<T = unknown>(res: Response, opts: ReadOptions = {}): Promise<T> {
  const text = await res.text().catch(() => "");
  const data = tryParse(text);
  if (!res.ok) {
    const { error, code } = errorOf(data);
    throw new HttpError(messageFor(res.status, error, opts), res.status, code);
  }
  if (data === undefined) {
    // 200 with an empty / HTML body: a proxy or middleware swallowed the real answer.
    throw new HttpError("The server returned an unexpected response. Please try again.", res.status);
  }
  return data as T;
}

/** `fetch` + `readJsonResponse`; network failures also become a readable `HttpError` (status 0). */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: ReadOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new HttpError("Could not reach the server. Check your connection and try again.", 0);
  }
  return readJsonResponse<T>(res, opts);
}
