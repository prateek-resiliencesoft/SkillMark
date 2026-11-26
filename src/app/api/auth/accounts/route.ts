import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { MAX_ACCOUNTS, readAccountTokens, tokenSubject } from "@/lib/auth-accounts";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromToken } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Accounts signed in on this browser. `expired` ones need a fresh sign-in. */
export async function GET() {
  const jar = cookies();
  const tokens = readAccountTokens(jar);
  const activeId = tokenSubject(jar.get(SESSION_COOKIE)?.value ?? "")?.id;

  const rows = await Promise.all(
    tokens.map(async (t) => {
      const sub = tokenSubject(t)!;
      const user = await getUserFromToken(t);
      return { id: sub.id, email: user?.email ?? sub.email, expired: !user };
    }),
  );

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar")
    .in("id", rows.map((r) => r.id));
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return NextResponse.json({
    max: MAX_ACCOUNTS,
    accounts: rows.map((r) => ({
      ...r,
      name: (byId.get(r.id)?.name as string | null) ?? null,
      avatar: (byId.get(r.id)?.avatar as string | null) ?? null,
      active: r.id === activeId,
    })),
  });
}
