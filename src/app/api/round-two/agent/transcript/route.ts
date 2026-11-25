import { NextResponse } from "next/server";
import { z } from "zod";
import { listRoomIdentities, sendToIdentities } from "@/lib/livekit";
import { DATA_TOPICS, USER_IDENTITY_PREFIX, speakerRoleForIdentity } from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAgentRequest } from "@/server/round-two/agent-auth";
import { scheduleTurnCopilot } from "@/server/round-two/copilot";

export const dynamic = "force-dynamic";

const Segment = z.object({
  roundTwoId: z.string().uuid(),
  identity: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  text: z.string().trim().min(1).max(8000),
  /** Epoch ms of utterance start / end (fractional values are rounded). */
  startedAt: z.number().positive().transform(Math.round),
  endedAt: z.number().positive().transform(Math.round),
});

/** Agent posts one final STT utterance; app stores it, fans out to the panel, nudges the copilot. */
export async function POST(req: Request) {
  if (!isAgentRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Segment.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid segment" }, { status: 400 });
  const s = parsed.data;
  const speakerRole = speakerRoleForIdentity(s.identity);
  if (!speakerRole) return NextResponse.json({ error: "Unknown speaker" }, { status: 400 });

  const { data: round } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, status, "startedAt", "livekitRoom"')
    .eq("id", s.roundTwoId)
    .maybeSingle();
  if (!round || round.status !== "live") return NextResponse.json({ error: "Round not live" }, { status: 409 });

  const origin = round.startedAt ? new Date(round.startedAt as string).getTime() : s.startedAt;
  const startMs = Math.max(0, s.startedAt - origin);
  const endMs = Math.max(startMs, s.endedAt - origin);
  const { error } = await supabaseAdmin.from("round_two_transcript").insert({
    roundTwoId: s.roundTwoId,
    speakerRole,
    participantId: s.identity,
    speakerName: speakerRole === "candidate" ? "Candidate" : s.name ?? null,
    text: s.text,
    startMs,
    endMs,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const panel = (await listRoomIdentities(round.livekitRoom as string)).filter((i) => i.startsWith(USER_IDENTITY_PREFIX));
  await sendToIdentities(round.livekitRoom as string, panel, DATA_TOPICS.transcript, { roundTwoId: s.roundTwoId });
  if (speakerRole === "candidate") scheduleTurnCopilot(s.roundTwoId);
  return NextResponse.json({ ok: true });
}
