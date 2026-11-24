import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { readAccountTokens, setAccountsCookie, withAccount } from "@/lib/auth-accounts";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";
import { GOOGLE_STATE_COOKIE, GOOGLE_TOKEN_URL, googleConfig, verifyGoogleIdToken, verifyOAuthState } from "@/lib/google-oauth";
import { createLogger } from "@/lib/logger";
import { createUser, ensureProfileRow, findUserByEmail, getUserById, issueSessionToken } from "@/lib/users";
import { appBaseUrl } from "@/server/batch-access";

export const dynamic = "force-dynamic";
const log = createLogger("auth/google");

function fail(base: string, next: string, code: string) {
  const res = NextResponse.redirect(`${base}/login?next=${encodeURIComponent(next)}&error=${code}`);
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  return res;
}

export async function GET(req: Request) {
  const base = appBaseUrl();
  const url = new URL(req.url);
  const saved = await verifyOAuthState(cookies().get(GOOGLE_STATE_COOKIE)?.value);
  const next = saved?.next ?? "/dashboard";
  const cfg = googleConfig();
  if (!cfg) return fail(base, next, "google_unavailable");
  if (!saved || url.searchParams.get("state") !== saved.state) return fail(base, next, "google_state");
  const code = url.searchParams.get("code");
  if (!code) return fail(base, next, url.searchParams.get("error") === "access_denied" ? "google_cancelled" : "google_failed");

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: `${base}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!tokenRes.ok || !tokens.id_token) {
      log.warn("token exchange failed", tokenRes.status, tokens.error);
      return fail(base, next, "google_failed");
    }
    const identity = await verifyGoogleIdToken(tokens.id_token, cfg.clientId);

    const row = await findUserByEmail(identity.email);
    let user;
    if (row) {
      if (row.paused_at) return fail(base, next, "account_paused");
      user = await getUserById(row.id);
      if (!user) return fail(base, next, "google_failed");
      await ensureProfileRow(user, identity.name);
    } else {
      // Google-only account: random password nobody knows; password reset can set one later.
      const created = await createUser(identity.email, randomBytes(32).toString("base64url"), {
        full_name: identity.name ?? undefined,
        avatar_url: identity.picture ?? undefined,
        provider: "google",
      });
      if (!created.user) {
        log.warn("google signup failed", created.error);
        return fail(base, next, "google_failed");
      }
      user = created.user;
      await ensureProfileRow(user, identity.name);
    }

    const token = await issueSessionToken(user);
    const res = NextResponse.redirect(`${base}${next}`);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    setAccountsCookie(res, withAccount(readAccountTokens(cookies()), token));
    res.cookies.delete(ACTIVE_ORG_COOKIE);
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  } catch (err) {
    log.error("google callback failed", err instanceof Error ? err.message : err);
    return fail(base, next, "google_failed");
  }
}
