import { checkRateLimit } from "@/lib/api-rate-limit";
import { createLogger } from "@/lib/logger";
import { finalizeRecordingParts, scheduleRecordingFinalize } from "@/lib/recording-parts-server";
import { clientIp } from "@/lib/client-ip";
import { gateCandidateSession, isSessionId, rejectCrossSiteRequest } from "@/lib/session-access";
import { isLiveInterviewUpload } from "@/lib/storage-cap";
import { NextResponse } from "next/server";

const log = createLogger("api/session/recording/finalize");

/**
 * POST { sessionId, background? } — join the recording parts uploaded during
 * the interview into one file and link it to the session. Safe to call more
 * than once.
 *
 * background: true (what the interview page sends) answers 202 right away and
 * joins on the server with retries, so ending the interview never waits on
 * downloading and joining every part.
 */
export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const limited = checkRateLimit(`session:recording-finalize:${clientIp(req)}`);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (!isSessionId(sessionId)) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    const sessionLimited = checkRateLimit(`session:recording-finalize:${sessionId}`, 6);
    if (sessionLimited) return sessionLimited;

    const gate = await gateCandidateSession(req, sessionId, "id, status, completedAt, supersededAt, capabilityRequired, mediaClearedAt");
    if (!gate.ok) return gate.response;
    const { session } = gate;
    // Abandoned sessions are finalized server-side by the abandon route; candidates
    // may only join parts while live or just after completing.
    if (session.mediaClearedAt || session.supersededAt || !isLiveInterviewUpload(session)) {
      return NextResponse.json({ error: "Session has ended" }, { status: 403 });
    }

    if (body?.background === true) {
      const scheduled = scheduleRecordingFinalize(sessionId, { deleteParts: true, reason: "interview end" });
      return NextResponse.json({ ok: true, status: scheduled ? "scheduled" : "already_scheduled" }, { status: 202 });
    }
    const result = await finalizeRecordingParts(sessionId, { deleteParts: true });
    if (result.status === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result.status === "failed") return NextResponse.json({ error: "Could not assemble recording", ...result }, { status: 500 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("Unexpected error:", err);
    return NextResponse.json({ error: "Finalize failed" }, { status: 500 });
  }
}
