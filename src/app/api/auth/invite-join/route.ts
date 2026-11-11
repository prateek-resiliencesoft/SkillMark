import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { readAccountTokens, setAccountsCookie, withAccount } from "@/lib/auth-accounts";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth-session";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { createUser, ensureProfileRow, findUserByEmail, verifyLogin } from "@/lib/users";
import { acceptOrgInviteForUser } from "@/server/accept-org-invite";
import { authenticateForInviteEmail } from "@/server/invite-join-auth";
import { clientIp } from "@/server/integrations/applications";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRPCError } from "@trpc/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimitResponse = checkRateLimit(`auth:invite-join:${ip}`);
  if (rateLimitResponse) return rateLimitResponse;

  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  const name = typeof body.name === "string" ? body.name : undefined;

  if (token.length < 8 || token.length > 64) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 400 });
  }

  const { data: invite } = await supabaseAdmin
    .from("organization_invites")
    .select("email, status")
    .eq("token", token)
    .maybeSingle();

  if (!invite || invite.status !== "PENDING") {
    return NextResponse.json(
      { error: "This invite link is not valid, expired, or already used." },
      { status: 404 },
    );
  }

  const authResult = await authenticateForInviteEmail(
    { email: String(invite.email), password, name },
    { findUserByEmail, verifyLogin, createUser },
  );

  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  // Profile must exist before accept / account UI; don't rely only on DB trigger timing.
  await ensureProfileRow(authResult.user, name);

  try {
    const joined = await acceptOrgInviteForUser(supabaseAdmin, authResult.user, token);
    const sessionToken = await signSession(authResult.user);
    const res = NextResponse.json({
      user: authResult.user,
      organizationId: joined.organizationId,
      role: joined.role,
    });
    res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    setAccountsCookie(res, withAccount(readAccountTokens(cookies()), sessionToken));
    res.cookies.set(ACTIVE_ORG_COOKIE, joined.organizationId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
    return res;
  } catch (err) {
    if (err instanceof TRPCError) {
      const status =
        err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[invite-join] accept failed", err);
    return NextResponse.json(
      { error: "Could not join the organization. Try again in a moment." },
      { status: 500 },
    );
  }
}
