import { NextResponse } from "next/server";
import { liveKitConfig, mintRoomToken } from "@/lib/livekit";
import { agentIdentity } from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAgentRequest } from "@/server/round-two/agent-auth";
import { roundTwoSttLanguages } from "@/server/round-two/media";
import { resolveRoundTwoStt } from "@/server/round-two/stt";

export const dynamic = "force-dynamic";

/**
 * Live rooms the transcription agent should be in, each with a hidden subscribe-only token
 * and the org's ordered speech-to-text endpoints (Settings → AI → Round 2 transcript).
 */
export async function GET(req: Request) {
  if (!isAgentRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!liveKitConfig()) return NextResponse.json({ rooms: [] });
  const { data } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, "livekitRoom", "organizationId", "sourceSessionId"')
    .eq("status", "live")
    .limit(50);
  const sttByOrg = new Map<string, ReturnType<typeof resolveRoundTwoStt>>();
  const sttFor = (orgId: string) => {
    if (!sttByOrg.has(orgId)) sttByOrg.set(orgId, resolveRoundTwoStt(orgId).catch(() => []));
    return sttByOrg.get(orgId)!;
  };
  // Gemini takes language hints (Hindi / Indian English) from the round 1 interview.
  const withLanguages = async (list: Awaited<ReturnType<typeof resolveRoundTwoStt>>, sourceSessionId: string | null) => {
    if (!list.some((t) => t.provider === "gemini")) return list;
    const languages = await roundTwoSttLanguages({ sourceSessionId });
    return list.map((t) => (t.provider === "gemini" ? { ...t, languages } : t));
  };
  const rooms = await Promise.all(
    (data ?? []).map(async (r) => ({
      roundTwoId: r.id as string,
      room: r.livekitRoom as string,
      stt: await withLanguages(await sttFor(r.organizationId as string), r.sourceSessionId as string | null),
      token: await mintRoomToken({
        room: r.livekitRoom as string,
        identity: agentIdentity(r.id as string),
        name: "Transcriber",
        kind: "agent",
        ttlSeconds: 60 * 60 * 4,
      }),
    })),
  );
  return NextResponse.json({ rooms });
}
