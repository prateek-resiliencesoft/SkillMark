import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { normalizeWhatsappPhone } from "@/lib/messaging/templates";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Update the current user's display name and/or WhatsApp phone. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");

  if (!hasName && !hasPhone) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const patch: { id: string; email: string; name?: string; phone?: string | null } = {
    id: user.id,
    email: user.email,
  };

  if (hasName) {
    const trimmed = String(body.name ?? "").trim();
    if (!trimmed) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    patch.name = trimmed;
  }

  if (hasPhone) {
    const raw = String(body.phone ?? "").trim();
    if (!raw) {
      patch.phone = null;
    } else {
      const normalized = normalizeWhatsappPhone(raw);
      if (!normalized) {
        return NextResponse.json(
          { error: "Enter a valid phone with country code, e.g. +919876543210" },
          { status: 400 },
        );
      }
      patch.phone = normalized;
    }
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .upsert(patch, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
