/** Client-safe API key scope helpers (no crypto). */

export type ApiKeyEnvironment = "test" | "live";
export const API_KEY_SCOPES = [
  "*",
  "sessions:read",
  "results:read",
  "transcripts:read",
  "candidates:read",
  "invites:write",
  "interviews:read",
  "interviews:write",
  "forms:read",
  "applications:read",
  "applications:write",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Plain labels for the key form. */
export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "*": "Full access",
  "sessions:read": "Read sessions",
  "results:read": "Read results and reports",
  "transcripts:read": "Read transcripts",
  "candidates:read": "Read candidates",
  "invites:write": "Create invites (can send email/WhatsApp)",
  "interviews:read": "Read interviews",
  "interviews:write": "Manage interviews",
  "forms:read": "Read forms",
  "applications:read": "Read applications",
  "applications:write": "Submit applications",
};

const LEGACY_READ_IMPLIES: ApiKeyScope[] = ["sessions:read", "results:read", "transcripts:read", "candidates:read"];

/**
 * Older dlv_ keys read sessions/results through "interviews:read"; keep that
 * working. New rsi_ keys only get exactly what was ticked.
 */
export function effectiveScopes(scopes: string[] | null | undefined, keyPrefix: string | null | undefined): string[] {
  const s = scopes && scopes.length ? [...scopes] : ["*"];
  if ((keyPrefix ?? "").startsWith("dlv_") && (s.includes("interviews:read") || s.includes("interviews:write"))) {
    for (const x of LEGACY_READ_IMPLIES) if (!s.includes(x)) s.push(x);
  }
  return s;
}

export function keyHasScope(scopes: string[] | null | undefined, needed: ApiKeyScope): boolean {
  const s = scopes && scopes.length ? scopes : ["*"];
  if (s.includes("*")) return true;
  if (s.includes(needed)) return true;
  // write implies read for the same resource
  const [res, act] = needed.split(":");
  return act === "read" && s.includes(`${res}:write`);
}
