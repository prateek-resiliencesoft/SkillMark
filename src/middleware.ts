import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-session";
import { safeNextPath } from "@/lib/safe-next";

const PROTECTED = [
  "/dashboard",
  "/interviews",
  "/candidates",
  "/questions",
  "/projects",
  "/organizations",
  "/org",
  "/settings",
  "/account",
  "/usage",
  "/integrations",
  "/admin",
  "/batches",
  "/round-two",
];

/** Round 2 room pages need a session; candidate (/r2/c/) and invite (/r2/join/) pages handle auth themselves. */
const ROOM_PATH = /^\/r2\/[0-9a-f-]{36}\/room\/?$/i;

const AUTH_PAGES = ["/login", "/register"];

/** Protects dashboard routes, cleans auth entry URLs, clears invalid session cookies. */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySession(token) : null;
  const path = request.nextUrl.pathname;

  // `/` → dashboard if signed in, otherwise clean `/login` (no ?next= noise)
  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/dashboard" : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Already signed in → leave auth pages for the intended destination
  // (unless adding another account via ?add=1)
  if (
    user &&
    !request.nextUrl.searchParams.has("add") &&
    AUTH_PAGES.some((p) => path === p || path.startsWith(p + "/"))
  ) {
    const url = request.nextUrl.clone();
    const dest = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), url.origin);
    url.pathname = dest.pathname;
    url.search = dest.search;
    return NextResponse.redirect(url);
  }

  // Protected app routes require a session
  if (!user && (PROTECTED.some((p) => path === p || path.startsWith(p + "/")) || ROOM_PATH.test(path))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", path);
  requestHeaders.set("x-search", request.nextUrl.search);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (token && !user) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|vad/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
