import { svgDataUrlToPng } from "@/lib/ai/convert-svg";
import { extractJson } from "@/lib/ai/extract-json";
import { createLogger } from "@/lib/logger";
import { recordAiCallErrors } from "@/lib/session-error-log-server";
import { buildSummaryPrompt } from "@/lib/ai/prompts/summary";
import { resolveTaskModels } from "@/lib/ai/registry";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flagCaptureFailureIfNeeded } from "@/lib/session-summary";
import { NextResponse } from "next/server";

const log = createLogger("api/ai/summarize");

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await req.json();

  let reportProvider: unknown = null;
  try {
    const { data: interviewSession } = await supabaseAdmin
      .from("sessions")
      .select(
        `*, interview:interviews!inner(title, userId, projectId, objective, language, assessmentCriteria, questions(text, order, type), project:projects(organizationId)), messages(*)`,
      )
      .eq("id", sessionId)
      .order("order", { referencedTable: "interviews.questions", ascending: true })
      .order("timestamp", { referencedTable: "messages", ascending: true })
      .single();

    if (
      !interviewSession ||
      (interviewSession.interview as { userId: string }).userId !== user.id
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const interview = interviewSession.interview as {
      title: string;
      userId: string;
      projectId: string;
      objective: string | null;
      language: string;
      assessmentCriteria: { name: string; description: string }[] | null;
      questions: { text: string; order: number; type?: string }[];
      project?: { organizationId?: string } | null;
    };

    const msgs = (interviewSession.messages ?? []) as {
      contentType: string;
      whiteboardData: Record<string, unknown> | null;
      whiteboardImageUrl: string | null;
      role: string;
      content: string;
      transcription?: string | null;
    }[];

    const criteria = interview.assessmentCriteria;

    const whiteboardDrawingsRaw = msgs
      .filter((m) => m.contentType === "WHITEBOARD" && m.whiteboardData)
      .map((m) => ({
        label: (m.whiteboardData?.label as string) || "Untitled Drawing",
        imageDataUrl: m.whiteboardImageUrl ?? null,
      }));

    const whiteboardDrawings = await Promise.all(
      whiteboardDrawingsRaw.map(async (d) => ({
        ...d,
        imageDataUrl: d.imageDataUrl
          ? await svgDataUrlToPng(d.imageDataUrl)
          : null,
      })),
    );

    const codeSnippetsInput = msgs
      .filter((m) => m.contentType === "CODE" && m.whiteboardData)
      .map((m) => ({
        label: (m.whiteboardData?.label as string) || "Untitled Snippet",
        code: (m.whiteboardData?.code as string) || "",
        language: (m.whiteboardData?.language as string) || "plaintext",
      }))
      .filter((s) => s.code.trim().length > 0);

    const { provider, reportModel } = await resolveTaskModels(interview.project?.organizationId, "report");
    reportProvider = provider;
    const textMessages = msgs
      .filter((m) => m.contentType === "TEXT")
      // DB roles are USER / ASSISTANT; the prompt expects lowercase.
      .map((m) => ({ role: String(m.role).toLowerCase(), content: m.content }));

    if (await flagCaptureFailureIfNeeded(sessionId, textMessages, "api/ai/summarize")) {
      return NextResponse.json({ captureFailure: true });
    }
    const drawingsInput =
      whiteboardDrawings.length > 0 ? whiteboardDrawings : null;
    const codeInput = codeSnippetsInput.length > 0 ? codeSnippetsInput : null;

    const messages = buildSummaryPrompt(
      interview.title,
      textMessages,
      interview.objective,
      criteria,
      interview.questions,
      interview.language,
      drawingsInput,
      codeInput,
    );

    let response;
    try {
      response = await provider.generateResponse({
        messages,
        temperature: 0.3,
        maxTokens: 8192,
        model: reportModel,
      });
    } catch (err) {
      const isVisionError =
        err instanceof Error &&
        /image.*not supported|vision.*not supported|does not support.*image/i.test(
          err.message,
        );
      if (isVisionError && drawingsInput?.some((d) => d.imageDataUrl)) {
        log.info("Model does not support images, retrying text-only");
        const textOnlyDrawings = drawingsInput.map((d) => ({
          ...d,
          imageDataUrl: null,
        }));
        const fallbackMessages = buildSummaryPrompt(
          interview.title,
          textMessages,
          interview.objective,
          criteria,
          interview.questions,
          interview.language,
          textOnlyDrawings,
          codeInput,
        );
        response = await provider.generateResponse({
          messages: fallbackMessages,
          temperature: 0.3,
          maxTokens: 8192,
          model: reportModel,
        });
      } else {
        throw err;
      }
    }

    void recordAiCallErrors({ sessionId, provider, source: "api/ai/summarize", category: "report" });

    const parsed = extractJson(response.content);

    const insightsData: Record<string, unknown> = {
      keyInsights: parsed.keyInsights ?? [],
    };
    if (parsed.criteriaEvaluations) {
      insightsData.criteriaEvaluations = parsed.criteriaEvaluations;
    }
    if (parsed.questionEvaluations) {
      insightsData.questionEvaluations = parsed.questionEvaluations;
    }
    if (parsed.researchFindings) {
      insightsData.researchFindings = parsed.researchFindings;
    }
    if (parsed.toneAnalysis) {
      insightsData.toneAnalysis = parsed.toneAnalysis;
    }
    if (msgs.some((m) => m.role === "USER" && m.transcription === "recording")) {
      insightsData.transcriptSource = "recording";
    }

    await supabaseAdmin
      .from("sessions")
      .update({
        summary: String(parsed.summary ?? ""),
        themes: (parsed.themes as string[]) ?? [],
        sentiment: parsed.sentiment ?? null,
        insights: insightsData,
      })
      .eq("id", sessionId);

    return NextResponse.json(parsed);
  } catch (error) {
    log.error("Summary generation error:", error);
    await recordAiCallErrors({ sessionId, provider: reportProvider, source: "api/ai/summarize", category: "report", finalError: error });
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
