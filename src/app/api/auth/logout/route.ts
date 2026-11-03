import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
