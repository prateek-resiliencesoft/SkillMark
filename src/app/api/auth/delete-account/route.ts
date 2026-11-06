import { deleteAccount } from "@/lib/account-deletion";
import { getAuthUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { readAccountTokens, setAccountsCookie, withoutAccount } from "@/lib/auth-accounts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const result = await deleteAccount(user.id, { deletedBy: user.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(ACTIVE_ORG_COOKIE);
    setAccountsCookie(res, withoutAccount(readAccountTokens(cookies()), user.id));
    return res;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
