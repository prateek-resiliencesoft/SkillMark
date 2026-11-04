import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";
import { readAccountTokens, setAccountsCookie, tokenSubject, withAccount, withoutAccount } from "@/lib/auth-accounts";
import { getUserFromToken } from "@/lib/users";

export async function POST(req: Request) {
  const { userId } = await req.json().catch(() => ({}));
  const tokens = readAccountTokens(cookies());
  const token = tokens.find((t) => tokenSubject(t)?.id === userId);
  if (!token) {
    return NextResponse.json(
      { error: "That account is not signed in on this browser. Sign in to add it.", code: "NOT_SIGNED_IN" },
      { status: 404 },
    );
  }

  if (!(await getUserFromToken(token))) {
    const email = tokenSubject(token)?.email ?? "";
    const res = NextResponse.json(
      { error: `Your session for ${email || "this account"} has expired. Sign in again.`, code: "SESSION_EXPIRED", email },
      { status: 401 },
    );
    setAccountsCookie(res, withoutAccount(tokens, String(userId)));
    return res;
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  setAccountsCookie(res, withAccount(tokens, token));
  // Each account picks its own org after switching.
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
