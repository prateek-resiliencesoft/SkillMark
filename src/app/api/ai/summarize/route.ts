import { createLogger } from "@/lib/logger";
import { recordAiCallErrors } from "@/lib/session-error-log-server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSummaryForSession } from "@/lib/session-summary";
import { setReportStatus } from "@/lib/session-report-server";
import { NextResponse } from "next/server";

const log = createLogger("api/ai/summarize");

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await req.json();

  try {
    const { data: interviewSession } = await supabaseAdmin
      .from("sessions")
      .select(`id, interview:interviews!inner(userId)`)
      .eq("id", sessionId)
      .single();

    const rawInterview = interviewSession?.interview as unknown;
    const interviewOwner = (
      Array.isArray(rawInterview) ? rawInterview[0] : rawInterview
    ) as { userId?: string } | null | undefined;

    if (!interviewSession || interviewOwner?.userId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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
