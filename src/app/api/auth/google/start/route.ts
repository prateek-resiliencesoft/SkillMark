import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_MAX_AGE,
  buildGoogleAuthUrl,
  googleConfig,
  pkcePair,
  signOAuthState,
} from "@/lib/google-oauth";
import { safeNextPath } from "@/lib/safe-next";
import { appBaseUrl } from "@/server/batch-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = checkRateLimit(`auth:google:${clientIp(req)}`);
  if (limited) return limited;
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const base = appBaseUrl();
  const cfg = googleConfig();
  if (!cfg) {
    return NextResponse.redirect(`${base}/login?next=${encodeURIComponent(next)}&error=google_unavailable`);
  }
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const authUrl = buildGoogleAuthUrl({
    clientId: cfg.clientId,
    redirectUri: `${base}/api/auth/google/callback`,
    state,
    challenge,
    loginHint: url.searchParams.get("email"),
  });
  const res = NextResponse.redirect(authUrl);
  res.cookies.set(GOOGLE_STATE_COOKIE, await signOAuthState({ state, verifier, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    path: "/",
    maxAge: GOOGLE_STATE_MAX_AGE,
  });
  return res;
}
