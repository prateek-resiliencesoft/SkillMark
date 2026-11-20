import { checkRateLimit } from "@/lib/api-rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/client-ip";
import { recordPreflightEvent } from "@/lib/preflight-server";
import { decideStart, inviteExpiredForSession } from "@/lib/session-link";
import { abandonSession } from "@/lib/session-link-server";
import { gateCandidateSession, isSessionId, rejectCrossSiteRequest } from "@/lib/session-access";
import { NextResponse } from "next/server";

const START_FAILED = "Could not start this interview. Try again.";

/**
 * Candidate accepted the disclaimer and the live interview begins. From here
 * the tab must keep the session alive with heartbeats. Retries from the same
 * tab (`retry: true`) are idempotent; see decideStart.
 */
export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (!isSessionId(sessionId)) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    // Per session, not per IP: batch drives start many candidates behind one NAT.
    const limited = checkRateLimit(`session:start:${sessionId}`, 20) ?? checkRateLimit(`session:start-ip:${clientIp(req)}`, 600);
    if (limited) return limited;

    const gate = await gateCandidateSession(req, sessionId);
    if (!gate.ok) {
      return gate.response.status === 503 ? NextResponse.json({ error: START_FAILED }, { status: 503 }) : gate.response;
    }
    const { session, invite } = gate;

    // Revoked ("Send new link" / restarted attempt) or past the invite deadline:
    // the pre-flight session must not become a live interview.
    const revoked = !!session.supersededAt || (!!session.candidateId && invite?.sessionId !== sessionId);
    if (session.status === "IN_PROGRESS" && (revoked || inviteExpiredForSession(session, invite?.expiresAt))) {
      return NextResponse.json({ ok: false, expired: true, status: session.status }, { status: 409 });
    }

    const decision = decideStart(session, { retry: body?.retry === true });
    if (decision.action === "expired") {
      return NextResponse.json({ ok: false, expired: true, status: decision.status }, { status: 409 });
    }
    if (decision.action === "abandon_stale") {
      const ended = await abandonSession(sessionId, "DISCONNECTED");
      return NextResponse.json({ ok: false, expired: true, status: ended || "ABANDONED" }, { status: 409 });
    }

    const now = new Date().toISOString();
    if (decision.action === "resume") {
      const { error: touchError } = await supabaseAdmin
        .from("sessions")
        .update({ lastHeartbeatAt: now, lastActivityAt: now })
        .eq("id", sessionId)
        .eq("status", "IN_PROGRESS");
      if (touchError) return NextResponse.json({ error: START_FAILED }, { status: 503 });
      return NextResponse.json({ ok: true, resumed: true });
    }

    const { data: began, error: updateError } = await supabaseAdmin
      .from("sessions")
      .update({ interviewBeganAt: now, lastHeartbeatAt: now, lastActivityAt: now, preflightStep: "interview_started" })
      .eq("id", sessionId)
      .eq("status", "IN_PROGRESS")
      .is("interviewBeganAt", null)
      .is("supersededAt", null)
      .select("id");
    // Never answer ok without interviewBeganAt: an un-begun session is later swept as
    // preflight-idle. No row = lost a race (parallel start / abandon); the retry re-reads.
    if (updateError || !began?.length) return NextResponse.json({ error: START_FAILED }, { status: 503 });

    void recordPreflightEvent({
      candidateId: (session.candidateId as string | null) ?? null,
      sessionId,
      inviteToken: invite?.inviteToken ?? null,
      type: "interview_started",
      status: "done",
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
