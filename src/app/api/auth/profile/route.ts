import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Update the current user's display name. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { name } = await req.json().catch(() => ({}));
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("profiles").upsert({ id: user.id, email: user.email, name: trimmed }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
