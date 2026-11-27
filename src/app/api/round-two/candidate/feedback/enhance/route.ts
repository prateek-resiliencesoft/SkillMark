import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { FEEDBACK_ENHANCE_MAX, FEEDBACK_ENHANCE_MIN } from "@/lib/draft-candidate-feedback";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enhanceCandidateFeedback } from "@/server/draft-candidate-feedback";
import { hashRoundToken } from "@/server/round-two/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(10).max(200),
  draft: z.string().min(FEEDBACK_ENHANCE_MIN).max(FEEDBACK_ENHANCE_MAX),
});

/** Polish candidate's own R2 experience comment (does not save feedback). */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const limited = checkRateLimit(`r2:cand:feedback-enhance:${clientIp(req)}`, 8);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Write at least ${FEEDBACK_ENHANCE_MIN} characters to enhance.` },
      { status: 400 },
    );
  }

  const { data: round } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, status, "organizationId"')
    .eq("candidateTokenHash", hashRoundToken(parsed.data.token))
    .maybeSingle();

  if (!round) return NextResponse.json({ error: "This interview link is not valid" }, { status: 404 });
  if (round.status !== "ended") {
    return NextResponse.json({ error: "Feedback opens when the interview has ended" }, { status: 409 });
  }
  if (!round.organizationId) {
    return NextResponse.json({ error: "Enhance is not available for this interview" }, { status: 503 });
  }

  const result = await enhanceCandidateFeedback({
    organizationId: round.organizationId as string,
    draft: parsed.data.draft,
  });
  return NextResponse.json(result);
}
