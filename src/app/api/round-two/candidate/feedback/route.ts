import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashRoundToken } from "@/server/round-two/access";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(10).max(200),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/** Candidate's optional experience feedback after the interview ended (once, by link token). */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const limited = checkRateLimit(`r2:cand:feedback:${clientIp(req)}`, 10);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick 1 to 5 stars" }, { status: 400 });
  const { data: round } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, status, "candidateFeedbackAt"')
    .eq("candidateTokenHash", hashRoundToken(parsed.data.token))
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "This interview link is not valid" }, { status: 404 });
  if (round.status !== "ended") return NextResponse.json({ error: "Feedback opens when the interview has ended" }, { status: 409 });
  if (round.candidateFeedbackAt) return NextResponse.json({ error: "You already sent feedback. Thank you!" }, { status: 409 });
  const { error } = await supabaseAdmin
    .from("round_two_interviews")
    .update({
      candidateRating: parsed.data.rating,
      candidateFeedback: parsed.data.comment || null,
      candidateFeedbackAt: new Date().toISOString(),
    })
    .eq("id", round.id)
    .is("candidateFeedbackAt", null);
  if (error) return NextResponse.json({ error: "Could not save your feedback" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
