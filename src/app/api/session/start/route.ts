import { checkRateLimit } from "@/lib/api-rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp } from "@/server/integrations/applications";
import { recordPreflightEvent } from "@/lib/preflight-server";
import { NextResponse } from "next/server";

/**
 * Candidate accepted the disclaimer and the live interview begins. From here
 * the link is single-use: closing the tab or losing connection ends it.
 */
export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(`session:start:${clientIp(req)}`);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .select("id, status, interviewBeganAt, candidateId")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: "Could not start this interview. Try again." }, { status: 500 });
    }
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.status !== "IN_PROGRESS") {
      return NextResponse.json({ ok: false, expired: true }, { status: 409 });
    }
    // A second start on a began interview (e.g. reload) must not revive it.
    if (session.interviewBeganAt) {
      return NextResponse.json({ ok: false, expired: true }, { status: 409 });
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("sessions")
      .update({ interviewBeganAt: now, lastHeartbeatAt: now, lastActivityAt: now, preflightStep: "interview_started" })
      .eq("id", sessionId)
      .eq("status", "IN_PROGRESS");

    let inviteToken: string | null = null;
    if (session.candidateId) {
      const { data: candidate } = await supabaseAdmin
        .from("candidates")
        .select("inviteToken")
        .eq("id", session.candidateId)
        .maybeSingle();
      inviteToken = (candidate?.inviteToken as string | null) ?? null;
    }
    void recordPreflightEvent({
      candidateId: (session.candidateId as string | null) ?? null,
      sessionId,
      inviteToken,
      type: "interview_started",
      status: "done",
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
