import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
