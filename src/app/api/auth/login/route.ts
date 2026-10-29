import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/users";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth-session";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/server/integrations/applications";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimitResponse = checkRateLimit(`auth:login:${ip}`);
  if (rateLimitResponse) return rateLimitResponse;

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  const user = await verifyPassword(String(email), String(password));
  if (!user) return NextResponse.json({ error: "Invalid login credentials" }, { status: 401 });
  const token = await signSession(user);
  const res = NextResponse.json({ user, access_token: token });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
