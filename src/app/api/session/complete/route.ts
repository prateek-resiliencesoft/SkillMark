import {
  computeMessageBasedDuration,
  computeSegmentDuration,
  effectiveNowForSession,
  type ActivitySegment,
} from "@/app/api/voice/save/logic";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifySessionCompleted } from "@/server/completion-notify";
import { NextResponse } from "next/server";
import { canMarkCompleted, REPORT_DELAY_AFTER_COMPLETE_MS } from "@/lib/session-report-policy";
import { scheduleSessionReport } from "@/lib/session-report-server";
import { candidateWriteWindow, completionEndReason } from "@/lib/session-link";
import { interviewReachedClosing } from "@/lib/session-link-server";
import { CANDIDATE_SESSION_GATE_COLUMNS, gateCandidateSession, rejectCrossSiteRequest } from "@/lib/session-access";

const log = createLogger("api/session/complete");

export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const ip = clientIp(req);
    const rateLimited = checkRateLimit(`session:complete:${ip}`);
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    const gate = await gateCandidateSession(req, body?.sessionId, `${CANDIDATE_SESSION_GATE_COLUMNS}, startedAt, activitySegments`);
    if (!gate.ok) return gate.response;
    const { session, invite } = gate;
    const sessionId = session.id;

    if (!canMarkCompleted(session.status as string)) {
      return NextResponse.json({ ok: true, alreadyCompleted: session.status === "COMPLETED" });
    }
    // Only a live session, or the short tab-close race after an abandon, may complete.
    if (candidateWriteWindow(session, { inviteExpiresAt: invite?.expiresAt }) === "closed") {
      return NextResponse.json({ ok: false, expired: true, status: session.status }, { status: 409 });
    }
    const wasAbandoned = session.status === "ABANDONED";
    // Explicit quit (End interview button) → COMPLETED + endReason QUIT, unless the interview had already finished.
    const endReason = completionEndReason(body?.reason, body?.reason === "quit" ? await interviewReachedClosing(sessionId) : false);

    const now = new Date();
    const cappedNowMs = effectiveNowForSession(session.lastActivityAt as string | null, now.getTime());
    const cappedNowIso = new Date(cappedNowMs).toISOString();
    const segments = ((session.activitySegments ?? []) as ActivitySegment[]);
    const closed = segments.map((s) =>
      s.leftAt === null ? { ...s, leftAt: cappedNowIso } : s,
    );

    let duration: number;
    if (closed.length > 0) {
      duration = computeSegmentDuration(closed, cappedNowMs);
    } else {
      const { data: msgRows } = await supabaseAdmin
        .from("messages")
        .select("timestamp")
        .eq("sessionId", sessionId)
        .order("timestamp", { ascending: true });
      const msgTimesMs = (msgRows ?? []).map((r) => new Date(r.timestamp as string).getTime());
      duration = computeMessageBasedDuration(
        new Date(session.startedAt as string).getTime(),
        msgTimesMs,
        cappedNowMs,
      );
    }

    const writeCompletion = (withReason: boolean) =>
      supabaseAdmin
      .from("sessions")
      .update({
        status: "COMPLETED" as const,
        completedAt: now.toISOString(),
        activitySegments: closed,
        totalDurationSeconds: duration,
        ...(withReason ? { endReason } : {}),
      })
      .eq("id", sessionId)
      .eq("status", session.status as string)
      .is("supersededAt", null)
      .select("id");
    let { data: written, error: writeErr } = await writeCompletion(true);
    if (writeErr && /endReason|42703|PGRST204/.test(`${writeErr.code} ${writeErr.message}`)) {
      ({ data: written, error: writeErr } = await writeCompletion(false));
    }
    if (writeErr) {
      log.error(`Session ${sessionId} completion write failed: ${writeErr.message}`);
      return NextResponse.json({ error: "Could not complete session" }, { status: 500 });
    }
    // Lost a race (parallel completion / abandon / disqualify): the other write wins.
    if (!written?.length) return NextResponse.json({ ok: true, alreadyCompleted: false });

    log.info(`Session ${sessionId} completed via safety-net (${duration}s)`);
    void notifySessionCompleted(supabaseAdmin, sessionId);
    scheduleSessionReport(sessionId, "completed:safety-net", REPORT_DELAY_AFTER_COMPLETE_MS, { force: wasAbandoned });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
