import { timingSafeEqual } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RetranscribeError, retranscribeSessionFromRecording } from "@/lib/transcript/retranscribe";
import { getOrgMembership, hasProjectAccess } from "@/server/trpc";
import { NextResponse } from "next/server";

const log = createLogger("api/session/retranscribe");

// Transcribing ~15 min of audio can take a couple of minutes.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CLI access from inside the app container (scripts/retranscribe-session.mjs). */
function hasInternalSecret(req: Request): boolean {
  const secret = (process.env.CRON_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "");
  const given = req.headers.get("x-retranscribe-secret") || "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/session/retranscribe  { sessionId }
 * Rebuild the candidate's transcript from the session recording, then
 * regenerate the report. Org members (not viewers) with project access only.
 */
export async function POST(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  let source = "api/session/retranscribe";
  if (hasInternalSecret(req)) {
    source = "cli/retranscribe-session";
  } else {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: row } = await supabaseAdmin
      .from("sessions")
      .select("interview:interviews!inner(projectId, project:projects!inner(organizationId))")
      .eq("id", sessionId)
      .maybeSingle();
    const interview = (row as { interview?: { projectId: string; project: { organizationId: string } } } | null)
      ?.interview;
    if (!interview) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const membership = await getOrgMembership(supabaseAdmin, interview.project.organizationId, user.id);
    if (!membership || membership.role === "VIEWER") {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    if (!(await hasProjectAccess(supabaseAdmin, interview.projectId, user.id))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }

  try {
    const result = await retranscribeSessionFromRecording(sessionId, { source });
    log.info(`Re-transcribed ${sessionId}: ${result.candidateLines} candidate lines, report=${result.summary}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RetranscribeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error("Re-transcribe failed:", err);
    return NextResponse.json(
      { error: `Re-transcribe failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}` },
      { status: 500 },
    );
  }
}
