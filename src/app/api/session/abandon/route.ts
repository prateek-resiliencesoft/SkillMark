import { checkRateLimit } from "@/lib/api-rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { abandonSession } from "@/lib/session-link-server";
import { clientIp } from "@/server/integrations/applications";
import { NextResponse } from "next/server";

/**
 * Sent via sendBeacon when the candidate closes/leaves the tab mid-interview.
 * Only applies once the interview has begun (onboarding reloads are harmless).
 */
export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(`session:abandon:${clientIp(req)}`);
    if (limited) return limited;

    // sendBeacon posts text/plain; parse leniently.
    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status, interviewBeganAt")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!session.interviewBeganAt) return NextResponse.json({ ok: true, ended: false });

    const ended = await abandonSession(sessionId, "TAB_CLOSED");
    return NextResponse.json({ ok: true, ended });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
