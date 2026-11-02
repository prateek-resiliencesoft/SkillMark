import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { assertActiveInterviewSession } from "@/lib/session-access";

const log = createLogger("api/voice/token");

/**
 * POST /api/voice/token
 * Bind voice init to an in-progress session for the given interview.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const access = await assertActiveInterviewSession(
      body.sessionId,
      body.interviewId,
    );
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status },
      );
    }

    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("id, title, aiName, questions(id)")
      .eq("id", access.interviewId)
      .order("order", { referencedTable: "questions", ascending: true })
      .maybeSingle();

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 },
      );
    }

    const questions = (interview.questions ?? []) as unknown[];

    return NextResponse.json({
      sessionId: access.sessionId,
      interviewTitle: interview.title,
      aiName: interview.aiName,
      questionCount: questions.length,
    });
  } catch (error) {
    log.error("Voice session init error:", error);
    return NextResponse.json(
      { error: "Failed to initialize voice session" },
      { status: 500 },
    );
  }
}
