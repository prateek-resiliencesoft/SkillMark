import { supabaseAdmin } from "@/lib/supabase/admin";
import { gateCandidateSession, rejectCrossSiteRequest } from "@/lib/session-access";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const body = await req.json().catch(() => null);
    const gate = await gateCandidateSession(req, body?.sessionId, "id, status, supersededAt, capabilityRequired, activitySegments");
    if (!gate.ok) return gate.response;
    const { session } = gate;

    // Ended sessions keep their final activity record.
    if (session.status !== "IN_PROGRESS" || session.supersededAt) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const segments = (session.activitySegments as { enteredAt: string; leftAt: string | null }[]) ?? [];
    const now = new Date().toISOString();

    const updated = segments.map((s) =>
      s.leftAt === null ? { ...s, leftAt: now } : s,
    );

    await supabaseAdmin
      .from("sessions")
      .update({ activitySegments: updated, lastActivityAt: now })
      .eq("id", session.id)
      .eq("status", "IN_PROGRESS");

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
