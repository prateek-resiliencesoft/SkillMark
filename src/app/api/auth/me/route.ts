import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ user: null, profile: null });
  const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return NextResponse.json({ user, profile: profile ?? null });
}
