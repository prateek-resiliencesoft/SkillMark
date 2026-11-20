/**
 * Post-login `next` destinations: same-origin relative paths only.
 * Client- and edge-safe (no imports).
 */
const BASE = "https://app.invalid";
export const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * Browsers treat `\` as `/` and strip tab/newline while parsing URLs, so
 * `/\evil.com` or `/\t/evil.com` become protocol-relative. Reject those
 * outright, then let the WHATWG parser confirm the result stays on our origin.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_NEXT_PATH): string {
  if (!raw || typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (parsed.origin !== BASE) return fallback;
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}
