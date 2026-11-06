import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAccountTokens, setAccountsCookie, withAccount } from "@/lib/auth-accounts";
import { verifyLogin } from "@/lib/users";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth-session";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/server/integrations/applications";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimitResponse = checkRateLimit(`auth:login:${ip}`);
  if (rateLimitResponse) return rateLimitResponse;

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  const result = await verifyLogin(String(email), String(password));
  if (!result.ok) {
    if (result.reason === "paused") {
      return NextResponse.json(
        { error: "This account is paused. Please contact support to restore access." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Invalid login credentials" }, { status: 401 });
  }
  const user = result.user;
  const token = await signSession(user);
  const res = NextResponse.json({ user, access_token: token });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  setAccountsCookie(res, withAccount(readAccountTokens(cookies()), token));
  // Fresh login → no active org yet, so the dashboard shows the org picker.
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
