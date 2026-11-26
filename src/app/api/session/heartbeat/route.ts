import { supabaseAdmin } from "@/lib/supabase/admin";
import { isHeartbeatStale, inviteExpiredForSession } from "@/lib/session-link";
import { abandonSession } from "@/lib/session-link-server";
import { gateCandidateSession, rejectCrossSiteRequest } from "@/lib/session-access";
import { NextResponse } from "next/server";

/** Tab keep-alive. Replies `expired: true` once the session has ended. */
export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const body = await req.json().catch(() => null);
    const gate = await gateCandidateSession(req, body?.sessionId);
    if (!gate.ok) return gate.response;
    const { session, invite } = gate;
    const sessionId = session.id;

    if (session.status !== "IN_PROGRESS") {
      return NextResponse.json({ ok: true, expired: session.status !== "COMPLETED", status: session.status });
    }
    // Revoked by "Send new link", or the invite ran out before the interview began.
    if (session.supersededAt || inviteExpiredForSession(session, invite?.expiresAt)) {
      return NextResponse.json({ ok: true, expired: true, status: session.status });
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
      .eq("status", "IN_PROGRESS")
      .is("supersededAt", null);
    return NextResponse.json({ ok: true, expired: false });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
