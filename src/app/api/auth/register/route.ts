import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAccountTokens, setAccountsCookie, withAccount } from "@/lib/auth-accounts";
import { createUser } from "@/lib/users";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth-session";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/server/integrations/applications";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimitResponse = checkRateLimit(`auth:register:${ip}`);
  if (rateLimitResponse) return rateLimitResponse;

  const { email, password, data } = await req.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  if (!password || String(password).length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const { user, error } = await createUser(String(email), String(password), (data as Record<string, unknown>) ?? {});
  if (!user) return NextResponse.json({ error: error || "Registration failed" }, { status: 400 });
  const token = await signSession(user);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  setAccountsCookie(res, withAccount(readAccountTokens(cookies()), token));
  // Fresh login → no active org yet, so the dashboard shows the org picker.
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
