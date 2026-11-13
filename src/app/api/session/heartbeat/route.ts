import { supabaseAdmin } from "@/lib/supabase/admin";
import { isHeartbeatStale } from "@/lib/session-link";
import { abandonSession } from "@/lib/session-link-server";
import { NextResponse } from "next/server";

/** Tab keep-alive. Replies `expired: true` once the session has ended. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status, interviewBeganAt, lastHeartbeatAt")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (session.status !== "IN_PROGRESS") {
      return NextResponse.json({ ok: true, expired: session.status !== "COMPLETED", status: session.status });
    }

    // Beats arrived too late (laptop slept / network gap): the link is gone.
    if (isHeartbeatStale(session)) {
      const ended = await abandonSession(sessionId, "DISCONNECTED");
      const status = ended || "ABANDONED";
      return NextResponse.json({ ok: true, expired: status !== "COMPLETED", status });
    }

    await supabaseAdmin
      .from("sessions")
      .update({ lastHeartbeatAt: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "IN_PROGRESS");
    return NextResponse.json({ ok: true, expired: false });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
