import { NextResponse } from "next/server";
import { liveKitConfig, mintRoomToken } from "@/lib/livekit";
import { agentIdentity } from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAgentRequest } from "@/server/round-two/agent-auth";
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
    .select('id, "livekitRoom", "organizationId"')
    .eq("status", "live")
    .limit(50);
  const sttByOrg = new Map<string, ReturnType<typeof resolveRoundTwoStt>>();
  const sttFor = (orgId: string) => {
    if (!sttByOrg.has(orgId)) sttByOrg.set(orgId, resolveRoundTwoStt(orgId).catch(() => []));
    return sttByOrg.get(orgId)!;
  };
  const rooms = await Promise.all(
    (data ?? []).map(async (r) => ({
      roundTwoId: r.id as string,
      room: r.livekitRoom as string,
      stt: await sttFor(r.organizationId as string),
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
