import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { BOARD_SNAPSHOT_MAX_CHARS, checkSnapshot, roundTwoRunAllowed } from "@/lib/round-two/boards";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashRoundToken } from "@/server/round-two/access";
import { loadBoardReplay, saveBoardSnapshot } from "@/server/round-two/boards";

export const dynamic = "force-dynamic";

/** Admitted candidate of a live round, by link token; null otherwise. */
async function loadLiveRound(token: string | null | undefined) {
  if (!token || token.length < 10 || token.length > 200) return null;
  const { data } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, status, "candidateAdmittedAt", "boardState"')
    .eq("candidateTokenHash", hashRoundToken(token))
    .maybeSingle();
  return data && roundTwoRunAllowed(data as { status: string; candidateAdmittedAt: string | null }) ? data : null;
}

/** Late-join replay for the candidate: open boards, task and their own latest snapshots. */
export async function GET(req: Request) {
  const limited = checkRateLimit(`r2:cand:board:get:${clientIp(req)}`, 60);
  if (limited) return limited;
  const round = await loadLiveRound(new URL(req.url).searchParams.get("token"));
  if (!round) return NextResponse.json({ error: "Not in a live interview" }, { status: 404 });
  return NextResponse.json(await loadBoardReplay(round.id as string, round.boardState));
}

const SaveBody = z.object({
  token: z.string().min(10).max(200),
  kind: z.enum(["coding", "whiteboard"]),
  data: z.string().max(BOARD_SNAPSHOT_MAX_CHARS),
});

/** Candidate's debounced snapshot (and the keepalive flush on leave). The candidate is the only writer. */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const text = await req.text().catch(() => "");
  if (text.length > BOARD_SNAPSHOT_MAX_CHARS + 1_000) return NextResponse.json({ error: "Snapshot is too large" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const parsed = SaveBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid snapshot" }, { status: 400 });
  const limited = checkRateLimit(`r2:cand:board:save:${hashRoundToken(parsed.data.token).slice(0, 16)}`, 60);
  if (limited) return limited;
  const round = await loadLiveRound(parsed.data.token);
  if (!round) return NextResponse.json({ error: "Not in a live interview" }, { status: 409 });
  const check = checkSnapshot(parsed.data.kind, parsed.data.data);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const ok = await saveBoardSnapshot(round.id as string, round.boardState, parsed.data.kind, check.data);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Could not save" }, { status: 500 });
}
