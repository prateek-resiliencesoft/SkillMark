/**
 * Skillmark auth session: httpOnly cookie holding an HS256 JWT signed with AUTH_SECRET.
 * Edge-safe (used by middleware) — only depends on `jose`.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "skillmark_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  created_at?: string;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, role: "authenticated", user_metadata: user.user_metadata ?? {} })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      user_metadata: (payload.user_metadata as Record<string, unknown>) ?? {},
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
