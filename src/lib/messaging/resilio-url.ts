export const RESILIO_DEFAULT_BASE_URL = "https://resiliohub.com";

/**
 * Builds the send_templet endpoint from an org-configured base URL. Query strings, fragments
 * and credentials are rejected so they cannot swap out the API path.
 */
export function resilioSendUrl(baseUrl?: string | null): string {
  const raw = baseUrl?.trim() || RESILIO_DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (/[?#]/.test(raw) || url.username || url.password) {
    throw new Error("ResilioHub base URL must not contain a query, fragment or credentials");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/send_templet`;
  return url.href;
}
