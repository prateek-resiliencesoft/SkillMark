import { readAccountTokens, setAccountsCookie, withAccount } from "@/lib/auth-accounts";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";
import { getUserFromToken, issueSessionToken, updatePassword } from "@/lib/users";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { newPassword } = await request.json();

    if (!newPassword) {
      return NextResponse.json(
        { error: "New password is required" },
        { status: 400 },
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const jar = cookies();
    const user = await getUserFromToken(jar.get(SESSION_COOKIE)?.value);

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { error } = await updatePassword(user.id, String(newPassword));

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    // Every older session (other devices, leaked tokens) is now revoked; keep this browser signed in.
    const token = await issueSessionToken(user);
    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    setAccountsCookie(res, withAccount(readAccountTokens(jar), token));
    return res;
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
