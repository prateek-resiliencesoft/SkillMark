/**
 * Session report generation shared by /api/voice/save (on completion),
 * /api/ai/summarize (manual regenerate) and the re-transcribe flow.
 * Server-only.
 */
import { svgDataUrlToPng } from "@/lib/ai/convert-svg";
import { extractJson } from "@/lib/ai/extract-json";
import { buildSummaryPrompt } from "@/lib/ai/prompts/summary";
import { resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { recordSessionError } from "@/lib/session-error-log-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assessCandidateCapture, buildCaptureFailure } from "@/lib/transcript/capture-check";

const log = createLogger("session-summary");

export type SummaryOutcome = "scored" | "capture_failure" | "no_messages";

/**
 * When interviewer lines exist but the candidate's answers are missing, store
 * insights.captureFailure and clear the score instead of grading silence.
 * Returns true when the session was flagged.
 */
export async function flagCaptureFailureIfNeeded(
  sessionId: string,
  textMessages: { role: string; content: string }[],
  source: string,
): Promise<boolean> {
  const check = assessCandidateCapture(textMessages);
  if (!check.failed) return false;
  const { data: row } = await supabaseAdmin
    .from("sessions")
    .select("audioRecordingUrl, mediaClearedAt")
    .eq("id", sessionId)
    .maybeSingle();
  const recordingAvailable = !!(row?.audioRecordingUrl && !row?.mediaClearedAt);
  const captureFailure = buildCaptureFailure(check, recordingAvailable);
  await supabaseAdmin
    .from("sessions")
    .update({ summary: null, themes: [], sentiment: null, insights: { keyInsights: [], captureFailure } })
    .eq("id", sessionId);
  log.warn(
    `Session ${sessionId}: candidate answers not captured (${check.assistantLines} interviewer lines, ` +
      `${check.candidateWords} candidate words) — report not scored`,
  );
  void recordSessionError({
    sessionId,
    category: "report",
    severity: "error",
    source,
    message: `Candidate answers weren't captured (${check.assistantLines} interviewer lines, ${check.candidateWords} candidate words). Report not scored.`,
    context: { stage: "capture_check", recordingAvailable },
  });
  return true;
}

/** Load the interview fields the summary prompt needs, then generate the report. */
export async function generateSummaryForSession(sessionId: string): Promise<SummaryOutcome> {
  const { data } = await supabaseAdmin
    .from("sessions")
    .select(
      `id, interview:interviews!inner(title, objective, language, assessmentCriteria, questions(text, order, type))`,
    )
    .eq("id", sessionId)
    .order("order", { referencedTable: "interviews.questions", ascending: true })
    .single();
  const interview = (data as { interview?: Record<string, unknown> } | null)?.interview as
    | {
        title: string;
        objective?: string | null;
        language?: string | null;
        assessmentCriteria?: { name: string; description: string }[] | null;
        questions?: { text: string; order: number; type?: string }[] | null;
      }
    | undefined;
  if (!interview) throw new Error("Session not found");
  return generateSessionSummary(
    sessionId,
    interview.title,
    interview.objective,
    interview.language,
    interview.questions,
    interview.assessmentCriteria,
  );
}

export async function generateSessionSummary(
  sessionId: string,
  interviewTitle: string,
  objective?: string | null,
  language?: string | null,
  questions?: { text: string; order: number; type?: string }[] | null,
  assessmentCriteria?: { name: string; description: string }[] | null,
): Promise<SummaryOutcome> {
  {
    const { data: allMessages } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: true });

    if (!allMessages || allMessages.length === 0) {
      log.info("No messages to summarize");
      return "no_messages";
    }

    const whiteboardDrawingsRaw = allMessages
      .filter((m) => m.contentType === "WHITEBOARD" && m.whiteboardData)
      .map((m) => {
        const data = m.whiteboardData as Record<string, unknown>;
        return {
          label: (data.label as string) || "Untitled Drawing",
          imageDataUrl: m.whiteboardImageUrl ?? null,
        };
      });

    const whiteboardDrawings = await Promise.all(
      whiteboardDrawingsRaw.map(async (d) => ({
        ...d,
        imageDataUrl: d.imageDataUrl
          ? await svgDataUrlToPng(d.imageDataUrl)
          : null,
      })),
    );

    const codeSnippetsInput = allMessages
      .filter(
        (m) => (m.contentType as string) === "CODE" && m.whiteboardData,
      )
      .map((m) => {
        const data = m.whiteboardData as Record<string, unknown>;
        return {
          label: (data.label as string) || "Untitled Snippet",
          code: (data.code as string) || "",
          language: (data.language as string) || "plaintext",
        };
      })
      .filter((s) => s.code.trim().length > 0);

    const { data: sessionMeta } = await supabaseAdmin
      .from("sessions")
      .select("interview:interviews!inner(project:projects(organizationId))")
      .eq("id", sessionId)
      .maybeSingle();
    const organizationId = (
      sessionMeta?.interview as { project?: { organizationId?: string } } | null
    )?.project?.organizationId;

    const { provider, reportModel } = await resolveTaskModels(organizationId, "report");
    const textMessages = allMessages
      .filter((m) => m.contentType === "TEXT")
      .map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      }));
    if (await flagCaptureFailureIfNeeded(sessionId, textMessages, "session-summary")) {
      return "capture_failure";
    }

    const drawingsInput =
      whiteboardDrawings.length > 0 ? whiteboardDrawings : null;
    const codeInput = codeSnippetsInput.length > 0 ? codeSnippetsInput : null;

    const promptMessages = buildSummaryPrompt(
      interviewTitle,
      textMessages,
      objective,
      assessmentCriteria,
      questions,
      language,
      drawingsInput,
      codeInput,
    );

    let response;
    try {
      response = await provider.generateResponse({
        messages: promptMessages,
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
          interviewTitle,
          textMessages,
          objective,
          assessmentCriteria,
          questions,
          language,
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

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(response.content);
    } catch (parseErr) {
      log.error(
        "Raw AI response (first 1000 chars):",
        response.content.slice(0, 1000),
      );
      throw parseErr;
    }

    const insightsData: Record<string, unknown> = {
      keyInsights: parsed.keyInsights ?? [],
    };
    if (allMessages.some((m) => m.role === "USER" && m.transcription === "recording")) {
      insightsData.transcriptSource = "recording";
    }
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

    await supabaseAdmin
      .from("sessions")
      .update({
        summary: String(parsed.summary ?? ""),
        themes: (parsed.themes as string[]) ?? [],
        sentiment: parsed.sentiment ?? null,
        insights: insightsData,
      })
      .eq("id", sessionId);

    const themeCount = Array.isArray(parsed.themes) ? parsed.themes.length : 0;
    const insightCount = Array.isArray(parsed.keyInsights)
      ? parsed.keyInsights.length
      : 0;
    const qEvalCount = Array.isArray(parsed.questionEvaluations)
      ? parsed.questionEvaluations.length
      : 0;
    log.info(
      `Summary generated for session ${sessionId}: ` +
        `${themeCount} themes, ${insightCount} insights, ${qEvalCount} question evaluations`,
    );
    return "scored";
  }
}
