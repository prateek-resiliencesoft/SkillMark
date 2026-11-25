import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { ensureRoom, liveKitConfig, listRoomIdentities, mintRoomToken, sendToIdentities } from "@/lib/livekit";
import { DATA_TOPICS, USER_IDENTITY_PREFIX, candidateIdentity } from "@/lib/round-two/types";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashRoundToken } from "@/server/round-two/access";

export const dynamic = "force-dynamic";

async function loadByToken(token: string | null) {
  if (!token || token.length < 10 || token.length > 200) return null;
  const { data } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, title, status, "scheduledAt", "durationMin", "livekitRoom", "candidateAdmittedAt", "organizationId", candidate:candidates!inner(name)')
    .eq("candidateTokenHash", hashRoundToken(token))
    .maybeSingle();
  return data;
}

/** Candidate pre-join info (no login). */
export async function GET(req: Request) {
  const limited = checkRateLimit(`r2:cand:info:${clientIp(req)}`, 60);
  if (limited) return limited;
  const round = await loadByToken(new URL(req.url).searchParams.get("token"));
  if (!round || round.status === "draft") return NextResponse.json({ error: "This interview link is not valid" }, { status: 404 });
  const { data: org } = await supabaseAdmin.from("organizations").select("name").eq("id", round.organizationId).maybeSingle();
  return NextResponse.json({
    title: round.title,
    status: round.status,
    scheduledAt: round.scheduledAt,
    durationMin: round.durationMin,
    candidateName: (round.candidate as unknown as { name: string }).name,
    organizationName: (org?.name as string | undefined) ?? "",
    videoReady: !!liveKitConfig(),
  });
}

const JoinBody = z.object({ token: z.string().min(10).max(200), consent: z.literal(true) });

/** Candidate join: records consent, returns a lobby token until the host admits them. */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const limited = checkRateLimit(`r2:cand:join:${clientIp(req)}`, 20);
  if (limited) return limited;
  const parsed = JoinBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please accept the recording notice to continue" }, { status: 400 });
  const round = await loadByToken(parsed.data.token);
  if (!round) return NextResponse.json({ error: "This interview link is not valid" }, { status: 404 });
  if (round.status !== "scheduled" && round.status !== "live") {
    return NextResponse.json({ error: round.status === "ended" ? "This interview has ended" : "This interview is not open" }, { status: 409 });
  }
  const cfg = liveKitConfig();
  if (!cfg) return NextResponse.json({ error: "Video is not available right now" }, { status: 503 });

  await supabaseAdmin
    .from("round_two_interviews")
    .update({ candidateConsentAt: new Date().toISOString() })
    .eq("id", round.id)
    .is("candidateConsentAt", null);
  await ensureRoom(round.livekitRoom as string);
  const admitted = !!round.candidateAdmittedAt && round.status === "live";
  const name = (round.candidate as unknown as { name: string }).name || "Candidate";
  const token = await mintRoomToken({
    room: round.livekitRoom as string,
    identity: candidateIdentity(round.id as string),
    name,
    kind: admitted ? "candidate" : "candidate_lobby",
    metadata: { role: "candidate" },
    ttlSeconds: 60 * 60 * 4,
  });
  if (!admitted) {
    const panel = (await listRoomIdentities(round.livekitRoom as string)).filter((i) => i.startsWith(USER_IDENTITY_PREFIX));
    await sendToIdentities(round.livekitRoom as string, panel, DATA_TOPICS.admit, { roundTwoId: round.id });
  }
  return NextResponse.json({ url: cfg.publicUrl, token, admitted });
}
