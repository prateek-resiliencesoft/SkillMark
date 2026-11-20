/**
 * Candidate session capability: a per-session HMAC token carried in an HttpOnly,
 * SameSite=Strict cookie. The session UUID alone is not a credential — it leaks
 * through ?sid= links, report URLs and logs — so candidate write/lifecycle routes,
 * public tRPC session procedures and the voice relays require this cookie for any
 * session whose `capabilityRequired` flag is set (db/init/39-session-capability.sql).
 *
 * Same-origin fetch, navigator.sendBeacon and WebSocket upgrades all send the cookie
 * automatically; cross-site requests do not (SameSite=Strict), which also blocks
 * cross-origin text/plain POSTs.
 *
 * Node-only (node:crypto); also imported by the voice relays under server/.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_PREFIX = "sm_sc_";
export const SESSION_CAPABILITY_MAX_AGE = 60 * 60 * 24 * 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subkey(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return createHmac("sha256", s).update("skillmark/session-capability/v1").digest();
}

export function sessionCapabilityCookieName(sessionId: string): string {
  return `${COOKIE_PREFIX}${sessionId.toLowerCase()}`;
}

export function signSessionCapability(sessionId: string): string {
  if (!UUID_RE.test(sessionId)) throw new Error("invalid session id");
  return createHmac("sha256", subkey()).update(`v1:${sessionId.toLowerCase()}`).digest("base64url");
}

export function verifySessionCapability(sessionId: string, token: string | null | undefined): boolean {
  if (!token || !UUID_RE.test(sessionId)) return false;
  const expected = Buffer.from(signSessionCapability(sessionId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sessionCapabilityCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_CAPABILITY_MAX_AGE,
  };
}

/** Parse a raw Cookie header (route handlers, WebSocket upgrade requests). */
export function readCapabilityFromCookieHeader(cookieHeader: string | null | undefined, sessionId: string): string | null {
  if (!cookieHeader) return null;
  const name = sessionCapabilityCookieName(sessionId);
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Decide whether a caller may act on a session. `capabilityRequired` comes from the
 * sessions row; legacy rows (false) are allowed without a cookie.
 */
export function sessionCapabilityOk(
  session: { id: string; capabilityRequired?: boolean | null },
  token: string | null | undefined,
): boolean {
  if (!session.capabilityRequired) return true;
  return verifySessionCapability(session.id, token);
}

/** Route-handler convenience: check the request's Cookie header. */
export function requestHasSessionCapability(
  req: Request,
  session: { id: string; capabilityRequired?: boolean | null },
): boolean {
  return sessionCapabilityOk(session, readCapabilityFromCookieHeader(req.headers.get("cookie"), session.id));
}

/** Set the capability cookie from a Route Handler / tRPC procedure (next/headers). */
export async function issueSessionCapabilityCookie(sessionId: string): Promise<void> {
  const { cookies } = await import("next/headers");
  cookies().set(sessionCapabilityCookieName(sessionId), signSessionCapability(sessionId), sessionCapabilityCookieOptions());
}

/** Read the capability cookie inside a tRPC procedure (next/headers). */
export async function readSessionCapabilityCookie(sessionId: string): Promise<string | null> {
  const { cookies } = await import("next/headers");
  return cookies().get(sessionCapabilityCookieName(sessionId))?.value ?? null;
}
