/**
 * Candidate feedback from the thank-you screen.
 *  GET  ?sessionId=…&token=…  → { available, submitted } (form shows only when available and not sent)
 *  POST { sessionId, inviteToken?, rating, tags?, comment? } → 201 | 400 | 403 | 404 | 409 | 410 | 503
 * Same access as the interview itself: the session id (and invite token for invite links).
 */
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { FeedbackInput } from "@/lib/candidate-feedback";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FeedbackError, feedbackStatus, submitFeedback } from "@/server/candidate-feedback";
import { clientIp } from "@/lib/client-ip";
import { requestHasSessionCapability } from "@/lib/session-capability";
import { rejectCrossSiteRequest } from "@/lib/session-access";

export const dynamic = "force-dynamic";
const log = createLogger("api/session/feedback");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const limited = checkRateLimit(`session:feedback:${clientIp(req)}`, 20);
  if (limited) return limited;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!UUID.test(sessionId)) return NextResponse.json({ available: false, submitted: false });
  try {
    return NextResponse.json(await feedbackStatus(supabaseAdmin, sessionId, url.searchParams.get("token") || undefined));
  } catch (err) {
    log.error("Feedback status failed:", err);
    return NextResponse.json({ available: false, submitted: false });
  }
}

export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const limited = checkRateLimit(`session:feedback:${clientIp(req)}`, 20);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const parsed = FeedbackInput.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: "BAD_REQUEST", message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid feedback" },
      { status: 400 },
    );
  }
  try {
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, capabilityRequired")
      .eq("id", parsed.data.sessionId)
      .maybeSingle();
    if (session && !requestHasSessionCapability(req, session as { id: string; capabilityRequired?: boolean | null })) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Not allowed." }, { status: 403 });
    }
    await submitFeedback(supabaseAdmin, parsed.data, { userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedbackError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    log.error("Feedback save failed:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Could not save feedback." }, { status: 500 });
  }
}
