import { checkRateLimit } from "@/lib/api-rate-limit";
import { createLogger } from "@/lib/logger";
import { finalizeRecordingParts } from "@/lib/recording-parts-server";
import { clientIp } from "@/server/integrations/applications";
import { NextResponse } from "next/server";

const log = createLogger("api/session/recording/finalize");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { sessionId } — join the recording parts uploaded during the interview
 * into one file and link it to the session. Safe to call more than once.
 */
export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(`session:recording-finalize:${clientIp(req)}`);
    if (limited) return limited;
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
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
