import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { getUserFromToken } from "@/lib/users";

/**
 * Server-side helper to get the authenticated user.
 * Supports the session cookie (web) and `Authorization: Bearer <session JWT>` (mobile/scripts).
 */
export async function getAuthUser() {
  try {
    const u = await getUserFromToken(cookies().get(SESSION_COOKIE)?.value);
    if (u) return u;
  } catch { /* no cookies in this context */ }
  try {
    const auth = headers().get("authorization");
    if (auth?.startsWith("Bearer ") && !auth.startsWith("Bearer dlv_")) {
      return await getUserFromToken(auth.slice(7));
    }
  } catch { /* ignore */ }
  return null;
}
