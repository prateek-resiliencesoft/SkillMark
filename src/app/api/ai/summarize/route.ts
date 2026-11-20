import { createLogger } from "@/lib/logger";
import { recordAiCallErrors } from "@/lib/session-error-log-server";
import { getAuthUser } from "@/lib/auth";
import { reportAccess } from "@/lib/report-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runReportWithTimeout, setReportStatus } from "@/lib/session-report-server";
import { hasProjectAccess } from "@/server/trpc";
import { requireOrgAccess, type MemberRole } from "@/server/tenant";
import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";

const log = createLogger("api/ai/summarize");

// Long transcripts can take a while with slower providers.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InterviewRef = { userId?: string | null; projectId?: string | null; project?: { organizationId?: string | null } | null };

/**
 * POST /api/ai/summarize  { sessionId }
 * Manual "Generate report" from the session results page. Allowed for the
 * same people who can open the report (org members with project access),
 * not only the interview's creator.
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const { data: row, error: loadError } = await supabaseAdmin
    .from("sessions")
    .select("id, interview:interviews!inner(userId, projectId, project:projects(organizationId))")
    .eq("id", sessionId)
    .maybeSingle();
  if (loadError) {
    log.error(`Loading session ${sessionId} failed:`, loadError.message);
    return NextResponse.json({ error: "Could not load the session" }, { status: 500 });
  }
  const raw = (row as { interview?: InterviewRef | InterviewRef[] } | null)?.interview;
  const interview = Array.isArray(raw) ? raw[0] : raw;
  if (!row || !interview) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const orgId = interview.project?.organizationId ?? null;
  let orgRole: MemberRole | null = null;
  if (orgId) {
    try {
      const { membership } = await requireOrgAccess(supabaseAdmin, orgId, user.id, { minRole: "MEMBER" });
      orgRole = membership.role;
    } catch (err) {
      if (!(err instanceof TRPCError)) throw err;
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
  }
  const projectAccess = !!interview.projectId && (await hasProjectAccess(supabaseAdmin, interview.projectId, user.id));
  const access = reportAccess({
    userId: user.id,
    interviewOwnerId: interview.userId,
    orgRole,
    hasProjectAccess: projectAccess,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    await setReportStatus(sessionId, "GENERATING", { reportStartedAt: new Date().toISOString(), reportError: null });
    const outcome = await runReportWithTimeout(sessionId);

    if (outcome === "capture_failure") {
      await setReportStatus(sessionId, "READY", { reportError: null });
      return NextResponse.json({ captureFailure: true });
    }
    if (outcome === "no_messages") {
      await setReportStatus(sessionId, "SKIPPED", { reportError: "No transcript" });
      return NextResponse.json({ error: "No messages to summarize" }, { status: 400 });
    }

    await setReportStatus(sessionId, "READY", { reportError: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Summary generation error:", error);
    const message = error instanceof Error ? error.message : String(error);
    // Never leave the page on "Generating report…".
    await setReportStatus(sessionId, "FAILED", { reportError: message.slice(0, 500) });
    await recordAiCallErrors({
      sessionId,
      provider: null,
      source: "api/ai/summarize",
      category: "report",
      finalError: error,
    });
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
