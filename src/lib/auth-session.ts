/**
 * ResilienceSoft Interview auth session: httpOnly cookie holding an HS256 JWT signed with AUTH_SECRET.
 * Edge-safe (used by middleware) — only depends on `jose`.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "skillmark_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const SESSION_PURPOSE = "auth-session";

export interface SessionUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  created_at?: string;
}

export interface VerifiedSession extends SessionUser {
  /** auth.users.token_version the token was minted under (0 for pre-versioning tokens). */
  tokenVersion: number;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser, tokenVersion = 0): Promise<string> {
  return new SignJWT({
    email: user.email,
    role: "authenticated",
    user_metadata: user.user_metadata ?? {},
    purpose: SESSION_PURPOSE,
    tv: tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

/**
 * AUTH_SECRET also signs other short-lived tokens (e.g. landing previews), so a
 * valid signature alone is not enough. Tokens minted before the purpose claim
 * existed are accepted only if they carry the old session shape and no purpose.
 */
function isSessionPayload(payload: JWTPayload): boolean {
  if (payload.purpose === SESSION_PURPOSE) return true;
  return (
    payload.purpose === undefined &&
    payload.role === "authenticated" &&
    typeof payload.email === "string" &&
    payload.tv === undefined
  );
}

export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || !isSessionPayload(payload)) return null;
    const tv = payload.tv;
    if (tv !== undefined && (typeof tv !== "number" || !Number.isInteger(tv) || tv < 0)) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      user_metadata: (payload.user_metadata as Record<string, unknown>) ?? {},
      tokenVersion: typeof tv === "number" ? tv : 0,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Only Secure over HTTPS. NODE_ENV=production + plain HTTP drops the cookie in browsers.
    secure: (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
