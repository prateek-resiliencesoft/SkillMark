import { createLogger } from "@/lib/logger";
import { recordAiCallErrors } from "@/lib/session-error-log-server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSummaryForSession } from "@/lib/session-summary";
import { setReportStatus } from "@/lib/session-report-server";
import { getOrgMembership, hasProjectAccess } from "@/server/trpc";
import { NextResponse } from "next/server";

const log = createLogger("api/ai/summarize");

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await req.json();

  try {
    // Same access rule as the results page (analysis.getSessionSummary): any org
    // member with project access may generate the report, not only the person
    // who created the interview. Viewers stay read-only.
    const { data: interviewSession } = await supabaseAdmin
      .from("sessions")
      .select(`id, interview:interviews!inner(userId, projectId, project:projects!inner(organizationId))`)
      .eq("id", sessionId)
      .maybeSingle();

    const rawInterview = interviewSession?.interview as unknown;
    const interview = (Array.isArray(rawInterview) ? rawInterview[0] : rawInterview) as
      | { userId?: string; projectId: string; project: { organizationId: string } | { organizationId: string }[] }
      | null
      | undefined;
    if (!interviewSession || !interview) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (interview.userId !== user.id) {
      const project = Array.isArray(interview.project) ? interview.project[0] : interview.project;
      const membership = project
        ? await getOrgMembership(supabaseAdmin, project.organizationId, user.id)
        : null;
      if (
        !membership ||
        membership.role === "VIEWER" ||
        !(await hasProjectAccess(supabaseAdmin, interview.projectId, user.id))
      ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const outcome = await generateSummaryForSession(sessionId);

    if (outcome === "capture_failure") {
      await setReportStatus(sessionId, "READY", { reportError: null });
      return NextResponse.json({ captureFailure: true });
    }
    if (outcome === "no_messages") {
      return NextResponse.json({ error: "No messages to summarize" }, { status: 400 });
    }

    await setReportStatus(sessionId, "READY", { reportError: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Summary generation error:", error);
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
