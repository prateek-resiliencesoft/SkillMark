import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { safeNextPath } from "@/lib/safe-next";
import { NextResponse } from "next/server";

/**
 * Clears a JWT that middleware still accepts but the DB user no longer validates.
 * Stops login↔dashboard redirect loops (ERR_TOO_MANY_REDIRECTS).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const login = new URL("/login", url.origin);
  login.searchParams.set("reason", "session_expired");
  const safe = safeNextPath(next, "");
  if (safe) login.searchParams.set("next", safe);

  const res = NextResponse.redirect(login);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
