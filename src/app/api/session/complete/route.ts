import {
  computeMessageBasedDuration,
  computeSegmentDuration,
  effectiveNowForSession,
  type ActivitySegment,
} from "@/app/api/voice/save/logic";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/server/integrations/applications";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifySessionCompleted } from "@/server/completion-notify";
import { NextResponse } from "next/server";
import { canMarkCompleted, REPORT_DELAY_AFTER_COMPLETE_MS } from "@/lib/session-report-policy";
import { scheduleSessionReport } from "@/lib/session-report-server";

const log = createLogger("api/session/complete");

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rateLimited = checkRateLimit(`session:complete:${ip}`);
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status, startedAt, lastActivityAt, interviewId, activitySegments")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMarkCompleted(session.status as string)) {
      return NextResponse.json({ ok: true, alreadyCompleted: session.status === "COMPLETED" });
    }
    const wasAbandoned = session.status === "ABANDONED";

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
        ...(withReason ? { endReason: "COMPLETED" } : {}),
      })
      .eq("id", sessionId)
      .in("status", ["IN_PROGRESS", "ABANDONED", "NOT_STARTED"]);
    let { error: writeErr } = await writeCompletion(true);
    if (writeErr && /endReason|42703|PGRST204/.test(`${writeErr.code} ${writeErr.message}`)) {
      ({ error: writeErr } = await writeCompletion(false));
    }
    if (writeErr) {
      log.error(`Session ${sessionId} completion write failed: ${writeErr.message}`);
      return NextResponse.json({ error: "Could not complete session" }, { status: 500 });
    }

    log.info(`Session ${sessionId} completed via safety-net (${duration}s)`);
    void notifySessionCompleted(supabaseAdmin, sessionId);
    scheduleSessionReport(sessionId, "completed:safety-net", REPORT_DELAY_AFTER_COMPLETE_MS, { force: wasAbandoned });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
