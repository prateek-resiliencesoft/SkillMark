/**
 * Session report generation shared by /api/voice/save (on completion),
 * /api/ai/summarize (manual regenerate) and the re-transcribe flow.
 * Server-only.
 */
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { svgDataUrlToPng } from "@/lib/ai/convert-svg";
import { extractGrounded, extractionsPrompt, type GroundedExtraction } from "@/lib/ai/extract";
import { runGraph, skipStep, step } from "@/lib/ai/graph/runtime";
import { extractJson } from "@/lib/ai/extract-json";
import {
  buildSummaryPrompt,
  type CandidateJudgingContext,
} from "@/lib/ai/prompts/summary";
import { resolveTaskModels } from "@/lib/ai/registry";
import {
  boundCodeSnippets,
  boundDrawings,
  boundTranscript,
  SUMMARY_MAX_MESSAGES_LOADED,
} from "@/lib/ai/summary-bounds";
import {
  experienceBucket,
  profileToResumeText,
  type CandidateProfile,
} from "@/lib/documents/cv-profile";
import { loadAutoIncludePremade } from "@/lib/auto-include-premade";
import { createLogger } from "@/lib/logger";
import { collectExcludedScoreTexts } from "@/lib/premade-sections";
import { recordSessionError } from "@/lib/session-error-log-server";
import { applyQuestionScoreExclusions } from "@/lib/session-score";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assessCandidateCapture, buildCaptureFailure } from "@/lib/transcript/capture-check";

const log = createLogger("session-summary");

export type SummaryOutcome = "scored" | "capture_failure" | "no_messages";

export type SummaryRunOptions = {
  /** Aborts provider calls and stops between stages when the run's time budget is spent. */
  signal?: AbortSignal;
};

/** Load workExperience / skills / resume for experience-calibrated code review. */
export async function loadCandidateJudgingContext(
  sessionId: string,
): Promise<CandidateJudgingContext | null> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("candidateId")
    .eq("id", sessionId)
    .maybeSingle();
  const candidateId = (session as { candidateId?: string | null } | null)?.candidateId;
  if (!candidateId) return null;

  const { data: c } = await supabaseAdmin
    .from("candidates")
    .select("workExperience, notes, skills, education, profile")
    .eq("id", candidateId)
    .maybeSingle();
  if (!c) return null;

  const profile = (c.profile ?? null) as
    | (Partial<CandidateProfile> & { resumeMarkdown?: string })
    | null;
  let resumeText = profile?.resumeMarkdown?.trim() || null;
  if (!resumeText && profile && (profile.name || profile.techStack?.length || profile.experience?.length)) {
    try {
      resumeText = profileToResumeText(profile as CandidateProfile);
    } catch {
      /* ignore malformed profile */
    }
  }

  const years = profile?.totalExperienceYears ?? null;
  return {
    workExperience: c.workExperience ?? (years != null ? experienceBucket(years) : null),
    notes: c.notes,
    skills: Array.isArray(c.skills) ? c.skills : [],
    education: c.education,
    resumeText,
    experienceYears: years,
  };
}

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
export async function generateSummaryForSession(
  sessionId: string,
  opts: SummaryRunOptions = {},
): Promise<SummaryOutcome> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(
      `id, interview:interviews!inner(title, objective, language, assessmentCriteria, questions(text, order, type, description, validationRules))`,
    )
    .eq("id", sessionId)
    .order("order", { referencedTable: "interviews.questions", ascending: true })
    .maybeSingle();
  if (error) {
    // Surface the real cause (e.g. a missing column) instead of "Session not found".
    log.error(`Loading session ${sessionId} for the report failed: ${error.message}`);
    throw new Error(`Could not load session for report: ${error.message}`);
  }
  const interview = (data as { interview?: Record<string, unknown> } | null)?.interview as
    | {
        title: string;
        objective?: string | null;
        language?: string | null;
        assessmentCriteria?: { name: string; description: string }[] | null;
        questions?: {
          text: string;
          order: number;
          type?: string;
          description?: string | null;
          validationRules?: unknown;
        }[] | null;
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
    opts,
  );
}

type Msg = Record<string, unknown> & { role: string; content: string; contentType?: string };
type Drawing = { label: string; imageDataUrl: string | null };
type CodeSnippet = { id?: string; label: string; code: string; language: string };

const EVIDENCE_CLASSES = [
  { name: "claim", description: "A checkable statement about the candidate's own experience, role or results" },
  { name: "example", description: "A concrete example or story the candidate uses to back an answer" },
  { name: "metric", description: "A number the candidate gives (scale, %, time, money, team size)" },
  { name: "weakness_signal", description: "An admission of a gap, uncertainty, or an answer that dodges the question" },
  { name: "strength_signal", description: "A clear sign of depth: trade-offs reasoned through, ownership, precise detail" },
];
/** Evidence extraction is a bonus: it gets a bounded slice of the report's time budget. */
const EVIDENCE_BUDGET_MS = 45_000;
const EVIDENCE_MIN_WORDS = 60;

const SummaryState = Annotation.Root({
  sessionId: Annotation<string>(),
  interviewTitle: Annotation<string>(),
  objective: Annotation<string | null>(),
  language: Annotation<string | null>(),
  questions: Annotation<{ text: string; order: number; type?: string }[] | null>(),
  assessmentCriteria: Annotation<{ name: string; description: string }[] | null>(),
  messages: Annotation<Msg[]>(),
  drawings: Annotation<Drawing[]>(),
  code: Annotation<CodeSnippet[]>(),
  textMessages: Annotation<{ role: string; content: string }[]>(),
  organizationId: Annotation<string | undefined>(),
  candidateContext: Annotation<CandidateJudgingContext | null>(),
  evidence: Annotation<GroundedExtraction[]>(),
  outcome: Annotation<SummaryOutcome | null>(),
});
type SS = typeof SummaryState.State;

function buildSummaryGraph() {
  const load = step<SS, Partial<SS>>("load", "Loading the interview transcript", async (st, ctx) => {
    const { data: allMessages } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("sessionId", st.sessionId)
      .order("timestamp", { ascending: true })
      .limit(SUMMARY_MAX_MESSAGES_LOADED);
    if (!allMessages || allMessages.length === 0) {
      log.info("No messages to summarize");
      ctx.note("No messages to summarize");
      return { messages: [], outcome: "no_messages" as const };
    }
    const { data: sessionMeta } = await supabaseAdmin
      .from("sessions")
      .select("interview:interviews!inner(project:projects(organizationId))")
      .eq("id", st.sessionId)
      .maybeSingle();
    const organizationId = (sessionMeta?.interview as { project?: { organizationId?: string } } | null)?.project?.organizationId;
    const textMessages = (allMessages as Msg[])
      .filter((m) => m.contentType === "TEXT")
      .map((m) => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content }));
    const userTurns = textMessages.filter((m) => m.role === "user").length;
    ctx.note(`${allMessages.length} message(s) · ${userTurns} candidate answer(s)`);
    return { messages: allMessages as Msg[], textMessages, organizationId };
  });

  const media = step<SS, Partial<SS>>("prepare_media", "Preparing whiteboards and code", async (st, ctx) => {
    const whiteboardDrawingsRaw = boundDrawings(
      st.messages
        .filter((m) => m.contentType === "WHITEBOARD" && m.whiteboardData)
        .map((m) => {
          const data = m.whiteboardData as Record<string, unknown>;
          return {
            label: String((data.label as string) || "Untitled Drawing").slice(0, 200),
            imageDataUrl: (m.whiteboardImageUrl as string | null) ?? null,
          };
        }),
    );
    // Sequential: each rasterization is memory-heavy.
    const drawings: Drawing[] = [];
    for (const d of whiteboardDrawingsRaw) {
      ctx.signal?.throwIfAborted();
      drawings.push({ ...d, imageDataUrl: d.imageDataUrl ? await svgDataUrlToPng(d.imageDataUrl) : null });
    }
    const code = boundCodeSnippets(
      st.messages
        .filter((m) => m.contentType === "CODE" && m.whiteboardData)
        .map((m) => {
          const data = m.whiteboardData as Record<string, unknown>;
          return {
            id: typeof m.content === "string" && m.content.trim() ? m.content.trim() : undefined,
            label: (data.label as string) || "Untitled Snippet",
            code: (data.code as string) || "",
            language: (data.language as string) || "plaintext",
          };
        })
        .filter((x) => x.code.trim().length > 0),
    );
    ctx.note(`${drawings.length} whiteboard drawing(s) · ${code.length} code snippet(s)`);
    return { drawings, code };
  });

  const capture = step<SS, Partial<SS>>("capture_check", "Checking the candidate's answers were captured", async (st, ctx) => {
    if (await flagCaptureFailureIfNeeded(st.sessionId, st.textMessages, "session-summary")) {
      ctx.note("Candidate answers weren't captured; report not scored");
      return { outcome: "capture_failure" as const };
    }
    ctx.note("Answers captured");
    return {};
  });

  const context = step<SS, Partial<SS>>("candidate_context", "Loading the candidate's CV and skills", async (st, ctx) => {
    const candidateContext = await loadCandidateJudgingContext(st.sessionId);
    ctx.note(candidateContext ? "Candidate profile loaded" : "No candidate profile (anonymous or public link)");
    return { candidateContext };
  });

  const evidence = step<SS, Partial<SS>>("extract_evidence", "Extracting evidence from the answers", async (st, ctx) => {
    const answers = st.textMessages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const budget = AbortSignal.timeout(EVIDENCE_BUDGET_MS);
    try {
      const r = await extractGrounded({
        source: answers.slice(0, 40_000),
        sourceId: "round1",
        classes: EVIDENCE_CLASSES,
        instructions: "The source is everything a job candidate said in an interview. Extract the evidence an evaluator needs.",
        organizationId: st.organizationId,
        task: "report",
        maxPerChunk: 15,
        signal: ctx.signal ? AbortSignal.any([ctx.signal, budget]) : budget,
      });
      ctx.note(`${r.items.length} grounded quote(s)${r.dropped ? ` · ${r.dropped} unverifiable dropped` : ""}`);
      return { evidence: r.items };
    } catch (err) {
      ctx.signal?.throwIfAborted();
      ctx.note(`Skipped (${err instanceof Error ? err.message : "error"}); scoring without it`);
      return { evidence: [] };
    }
  });

  const evaluate = step<SS, Partial<SS>>("evaluate", "Scoring answers against the criteria", async (st, ctx) => {
    const { provider, reportModel } = await resolveTaskModels(st.organizationId, "report");
    const promptTranscript = boundTranscript(st.textMessages);
    ctx.signal?.throwIfAborted();
    const drawingsInput = st.drawings.length > 0 ? st.drawings : null;
    const codeInput = st.code.length > 0 ? st.code : null;
    const build = (drawings: Drawing[] | null) => {
      const msgs = buildSummaryPrompt(
        st.interviewTitle,
        promptTranscript,
        st.objective,
        st.assessmentCriteria,
        st.questions,
        st.language,
        drawings,
        codeInput,
        st.candidateContext,
      );
      if (st.evidence.length) {
        const sys = msgs.find((m) => m.role === "system");
        if (sys && typeof sys.content === "string") {
          sys.content += `\n\nGROUNDED EVIDENCE (verbatim quotes from the candidate; prefer citing these):\n${extractionsPrompt(st.evidence, 50)}\n`;
        }
      }
      return msgs;
    };

    let response;
    try {
      response = await provider.generateResponse({
        messages: build(drawingsInput),
        temperature: 0.3,
        maxTokens: 8192,
        model: reportModel,
        signal: ctx.signal,
      });
    } catch (err) {
      const isVisionError =
        err instanceof Error && /image.*not supported|vision.*not supported|does not support.*image/i.test(err.message);
      if (isVisionError && drawingsInput?.some((d) => d.imageDataUrl)) {
        log.info("Model does not support images, retrying text-only");
        ctx.note("Model can't read images; retried text-only");
        response = await provider.generateResponse({
          messages: build(drawingsInput.map((d) => ({ ...d, imageDataUrl: null }))),
          temperature: 0.3,
          maxTokens: 8192,
          model: reportModel,
          signal: ctx.signal,
        });
      } else {
        throw err;
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(response.content);
    } catch (parseErr) {
      log.error("Raw AI response (first 1000 chars):", response.content.slice(0, 1000));
      throw parseErr;
    }

    const insightsData: Record<string, unknown> = { keyInsights: parsed.keyInsights ?? [] };
    if (st.messages.some((m) => m.role === "USER" && m.transcription === "recording")) {
      insightsData.transcriptSource = "recording";
    }
    for (const k of ["criteriaEvaluations", "questionEvaluations", "researchFindings", "toneAnalysis", "codeEvaluations"] as const) {
      if (parsed[k]) insightsData[k] = parsed[k];
    }
    if (st.evidence.length) {
      insightsData.evidence = st.evidence.slice(0, 60).map((e) => ({ class: e.class, text: e.text, attributes: e.attributes }));
    }

    const { error: saveError } = await supabaseAdmin
      .from("sessions")
      .update({
        summary: String(parsed.summary ?? ""),
        themes: (parsed.themes as string[]) ?? [],
        sentiment: parsed.sentiment ?? null,
        insights: insightsData,
      })
      .eq("id", st.sessionId);
    // Never report "READY" for a report that was not stored.
    if (saveError) throw new Error(`Could not save the report: ${saveError.message}`);

    const themeCount = Array.isArray(parsed.themes) ? parsed.themes.length : 0;
    const insightCount = Array.isArray(parsed.keyInsights) ? parsed.keyInsights.length : 0;
    const qEvalCount = Array.isArray(parsed.questionEvaluations) ? parsed.questionEvaluations.length : 0;
    log.info(
      `Summary generated for session ${st.sessionId}: ` +
        `${themeCount} themes, ${insightCount} insights, ${qEvalCount} question evaluations`,
    );
    ctx.note(`${qEvalCount} question evaluation(s) · ${insightCount} insight(s) · ${themeCount} theme(s)`);
    return { outcome: "scored" as const };
  });

  const answersWords = (st: SS) =>
    st.textMessages.filter((m) => m.role === "user").reduce((n, m) => n + m.content.split(/\s+/).length, 0);

  return new StateGraph(SummaryState)
    .addNode("load", load)
    .addNode("prepare_media", media)
    .addNode("capture_check", capture)
    .addNode("candidate_context", context)
    .addNode("extract_evidence", evidence)
    .addNode("evaluate", evaluate)
    .addEdge(START, "load")
    .addConditionalEdges("load", (st: SS) => (st.outcome ? END : "prepare_media"), ["prepare_media", END])
    .addEdge("prepare_media", "capture_check")
    .addConditionalEdges("capture_check", (st: SS) => (st.outcome ? END : "candidate_context"), ["candidate_context", END])
    .addConditionalEdges(
      "candidate_context",
      (st: SS, config: LangGraphRunnableConfig) => {
        if (process.env.ROUND1_EVIDENCE_EXTRACTION !== "false" && answersWords(st) >= EVIDENCE_MIN_WORDS) return "extract_evidence";
        skipStep(config, "extract_evidence", "Extracting evidence from the answers", "Answers too short or extraction turned off");
        return "evaluate";
      },
      ["extract_evidence", "evaluate"],
    )
    .addEdge("extract_evidence", "evaluate")
    .addEdge("evaluate", END)
    .compile();
}

export async function generateSessionSummary(
  sessionId: string,
  interviewTitle: string,
  objective?: string | null,
  language?: string | null,
  questions?: { text: string; order: number; type?: string }[] | null,
  assessmentCriteria?: { name: string; description: string }[] | null,
  opts: SummaryRunOptions = {},
): Promise<SummaryOutcome> {
  const r = await runGraph<SS>(buildSummaryGraph(), {
    flow: "round1-summary",
    subject: { type: "session", id: sessionId },
    signal: opts.signal,
    traceInput: { sessionId, interviewTitle },
    input: {
      sessionId,
      interviewTitle,
      objective: objective ?? null,
      language: language ?? null,
      questions: questions ?? null,
      assessmentCriteria: assessmentCriteria ?? null,
      messages: [],
      drawings: [],
      code: [],
      textMessages: [],
      organizationId: undefined,
      candidateContext: null,
      evidence: [],
      outcome: null,
    },
  });
  if (!r.state.outcome) throw new Error("Report run ended without an outcome");
  return r.state.outcome;
}
