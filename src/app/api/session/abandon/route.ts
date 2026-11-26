import { checkRateLimit } from "@/lib/api-rate-limit";
import { abandonSession } from "@/lib/session-link-server";
import { clientIp } from "@/lib/client-ip";
import { NextResponse } from "next/server";
import { finalizeRecordingParts } from "@/lib/recording-parts-server";
import { gateCandidateSession, rejectCrossSiteRequest } from "@/lib/session-access";

/**
 * Sent via sendBeacon when the candidate closes/leaves the tab mid-interview.
 * Only applies once the interview has begun (onboarding reloads are harmless).
 */
export async function POST(req: Request) {
  try {
    // sendBeacon posts the JSON Blob as application/json.
    const refused = rejectCrossSiteRequest(req, { json: true });
    if (refused) return refused;
    const limited = checkRateLimit(`session:abandon:${clientIp(req)}`);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const gate = await gateCandidateSession(req, body?.sessionId);
    if (!gate.ok) return gate.response;
    const { session } = gate;
    const sessionId = session.id;
    if (!session.interviewBeganAt) return NextResponse.json({ ok: true, ended: false });

    const ended = await abandonSession(sessionId, "TAB_CLOSED");
    // Keep whatever audio was uploaded in parts before the tab closed.
    if (ended) {
      setTimeout(() => {
        void finalizeRecordingParts(sessionId, { onlyIfMissing: true, deleteParts: false }).catch(() => undefined);
      }, 30_000);
    }
    return NextResponse.json({ ok: true, ended });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
