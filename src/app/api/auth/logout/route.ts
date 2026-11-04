import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";
import { readAccountTokens, setAccountsCookie, tokenSubject, withoutAccount } from "@/lib/auth-accounts";
import { getUserFromToken } from "@/lib/users";

/** Signs out the active account; another signed-in account (if any) becomes active. */
export async function POST() {
  const jar = cookies();
  const active = jar.get(SESSION_COOKIE)?.value;
  const activeId = active ? tokenSubject(active)?.id : undefined;
  let rest = activeId ? withoutAccount(readAccountTokens(jar), activeId) : readAccountTokens(jar);

  let next: string | null = null;
  for (const t of rest) {
    if (await getUserFromToken(t)) {
      next = t;
      break;
    }
  }
  if (next) rest = [next, ...rest.filter((t) => t !== next)];

  const res = NextResponse.json({ success: true, switchedTo: next ? tokenSubject(next)?.email ?? null : null });
  if (next) res.cookies.set(SESSION_COOKIE, next, sessionCookieOptions());
  else res.cookies.delete(SESSION_COOKIE);
  setAccountsCookie(res, rest);
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
