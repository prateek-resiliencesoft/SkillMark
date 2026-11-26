import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { BOARD_SNAPSHOT_MAX_CHARS, PREVIEW_MAX_CHARS, checkSnapshot, roundTwoRunAllowed } from "@/lib/round-two/boards";
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
    .select('id, status, "candidateAdmittedAt", "boardState", "livekitRoom"')
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
  /** The task this work belongs to (a late save for a closed task is refused). */
  taskId: z.string().max(60),
  data: z.string().max(BOARD_SNAPSHOT_MAX_CHARS),
  /** Submit = final answer for the open task (locks it). */
  submit: z.boolean().optional(),
  runOutput: z.object({ stdout: z.string().max(10_000), stderr: z.string().max(10_000), language: z.string().max(32) }).partial().optional(),
  /** Whiteboard drawing as an SVG data URL. */
  preview: z.string().max(PREVIEW_MAX_CHARS).optional(),
});

/** Candidate's debounced snapshot, keepalive flush on leave, or final Submit. The candidate is the only writer. */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const text = await req.text().catch(() => "");
  if (text.length > BOARD_SNAPSHOT_MAX_CHARS + PREVIEW_MAX_CHARS + 30_000) return NextResponse.json({ error: "Snapshot is too large" }, { status: 413 });
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
  const out = await saveBoardSnapshot(round.id as string, round.livekitRoom as string, round.boardState, parsed.data.kind, check.data, {
    taskId: parsed.data.taskId,
    submit: parsed.data.submit,
    runOutput: parsed.data.runOutput,
    preview: parsed.data.preview,
  });
  return out.ok ? NextResponse.json({ ok: true, state: out.state }) : NextResponse.json({ error: out.error }, { status: out.status });
}
