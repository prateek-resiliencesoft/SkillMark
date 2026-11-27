/**
 * POST { sessionId, inviteToken?, draft } → { comment, usedFallback? }
 * Polishes candidate's own feedback text. Same access as /api/session/feedback.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { FEEDBACK_ENHANCE_MAX, FEEDBACK_ENHANCE_MIN } from "@/lib/draft-candidate-feedback";
import { createLogger } from "@/lib/logger";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { requestHasSessionCapability } from "@/lib/session-capability";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FeedbackError, feedbackEnhanceContext } from "@/server/candidate-feedback";
import { enhanceCandidateFeedback } from "@/server/draft-candidate-feedback";

export const dynamic = "force-dynamic";
const log = createLogger("api/session/feedback/enhance");

const Body = z.object({
  sessionId: z.string().uuid(),
  inviteToken: z.string().min(1).max(200).optional(),
  draft: z.string().min(FEEDBACK_ENHANCE_MIN).max(FEEDBACK_ENHANCE_MAX),
});

export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const limited = checkRateLimit(`session:feedback-enhance:${clientIp(req)}`, 8);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: `Write at least ${FEEDBACK_ENHANCE_MIN} characters to enhance.` },
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

    const ctx = await feedbackEnhanceContext(supabaseAdmin, parsed.data.sessionId, parsed.data.inviteToken);
    const result = await enhanceCandidateFeedback({
      organizationId: ctx.organizationId,
      draft: parsed.data.draft,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FeedbackError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    if (err instanceof Error && /at least|too short|20/i.test(err.message)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: err.message }, { status: 400 });
    }
    log.error("Feedback enhance failed:", err);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Could not enhance feedback." }, { status: 500 });
  }
}
