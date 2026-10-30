import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-session";

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
  "/batches",
];

const AUTH_PAGES = ["/login", "/register"];

/** Only allow same-origin relative paths as post-login destinations. */
function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) {
    return "/dashboard";
  }
  return raw;
}

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
  if (user && AUTH_PAGES.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Protected app routes require a session
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const res = NextResponse.next({ request });
  if (token && !user) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
