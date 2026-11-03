/**
 * Active organization for this login session.
 * - Set when the user picks/creates/enters an org (client) — read by the dashboard layout (server).
 * - Cleared on login, register and logout so every fresh login shows the org picker.
 * Not httpOnly on purpose: it only holds an org id the user is a member of (re-checked server-side).
 */
export const ACTIVE_ORG_COOKIE = "sm_active_org";
/** Last org the user worked in; survives logout so the picker can highlight it. */
export const LAST_ORG_STORAGE_KEY = "aural:currentOrgId";

export function readActiveOrgCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_ORG_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function writeActiveOrgCookie(orgId: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax${secure}`;
}
