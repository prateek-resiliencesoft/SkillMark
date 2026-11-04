/**
 * Multi-account sign-in: an httpOnly cookie holding up to MAX_ACCOUNTS session
 * JWTs, most recently used first. SESSION_COOKIE stays the single active session.
 */
import { decodeJwt } from "jose";
import type { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";

export const ACCOUNTS_COOKIE = "skillmark_accounts";
export const MAX_ACCOUNTS = 3;

export function tokenSubject(token: string): { id: string; email: string } | null {
  try {
    const p = decodeJwt(token);
    return p.sub ? { id: p.sub, email: String(p.email ?? "") } : null;
  } catch {
    return null;
  }
}

/** Stored tokens plus the active session (older logins predate the accounts cookie). */
export function readAccountTokens(cookies: {
  get(name: string): { value: string } | undefined;
}): string[] {
  const stored = (cookies.get(ACCOUNTS_COOKIE)?.value ?? "").split(",").filter(Boolean);
  const active = cookies.get(SESSION_COOKIE)?.value;
  return dedupe(active ? [active, ...stored] : stored);
}

function dedupe(tokens: string[]): string[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    const id = tokenSubject(t)?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Put `token` first (replacing any older token for the same user), capped at MAX_ACCOUNTS. */
export function withAccount(tokens: string[], token: string): string[] {
  return dedupe([token, ...tokens]).slice(0, MAX_ACCOUNTS);
}

export function withoutAccount(tokens: string[], userId: string): string[] {
  return tokens.filter((t) => tokenSubject(t)?.id !== userId);
}

export function setAccountsCookie(res: NextResponse, tokens: string[]) {
  if (tokens.length === 0) res.cookies.delete(ACCOUNTS_COOKIE);
  else res.cookies.set(ACCOUNTS_COOKIE, tokens.join(","), sessionCookieOptions());
}
