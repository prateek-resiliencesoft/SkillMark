import { buildInterviewerPrompt } from "@/lib/ai/prompts/interviewer";
import { buildCandidateFocusSection } from "@/lib/ai/prompts/candidate-focus";
import { buildIntegrityProbingSection } from "@/lib/ai/prompts/integrity-probing";
import { isChineseInterviewLanguage } from "@/lib/interview-language";
import { effectiveIntegrityConfig, type IntegrityConfigInput } from "@/lib/integrity/config";
import { resolveProvider } from "@/lib/ai/registry";
import { taskFromFollowUpDepth } from "@/lib/ai/credentials";
import { createLogger } from "@/lib/logger";
import { nextAskableQuestionIndex } from "@/lib/question-conditions";
import { recordAiCallErrors } from "@/lib/session-error-log-server";
import type { LLMMessage } from "@/lib/ai/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertActiveInterviewSession, rejectCrossSiteRequest } from "@/lib/session-access";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { devanagariToRoman } from "@/lib/transcript/transliterate";

const log = createLogger("api/ai/chat");

const MAX_HISTORY_CHARS = 200_000;

/** Client history may only carry candidate and interviewer turns — never "system". */
const ChatRequest = z.object({
  sessionId: z.string().min(1).max(64),
  interviewId: z.string().min(1).max(64),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(400)
    .refine((ms) => ms.reduce((n, m) => n + m.content.length, 0) <= MAX_HISTORY_CHARS, "History too long"),
  currentQuestionIndex: z.number().int().min(0).max(10_000).optional(),
});

export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sessionId, interviewId, messages } = parsed.data;
  const limited = checkRateLimit(`ai:chat:${sessionId}`, 30);
  if (limited) return limited;

  let provider: Awaited<ReturnType<typeof resolveProvider>> | null = null;
  try {
    const access = await assertActiveInterviewSession(sessionId, interviewId, { req });
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status },
      );
    }

    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("*, questions(*), project:projects(organizationId)")
      .eq("id", access.interviewId)
      .order("order", { referencedTable: "questions", ascending: true })
      .single();

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 },
      );
    }

    const organizationId = (interview.project as { organizationId?: string } | null)?.organizationId;
    // Task routing (Settings → AI) owns provider order. Interview llmProvider is a soft prefer only.
    // Model: interview.llmModel applied only if it fits the active provider — never send gemini-* to OpenAI.
    provider = await resolveProvider({
      organizationId,
      idOrModel: interview.llmProvider,
      task: taskFromFollowUpDepth(interview.followUpDepth as string | undefined),
    });

    const questionCount = ((interview.questions ?? []) as unknown[]).length;
    const currentQuestionIndex = Math.min(parsed.data.currentQuestionIndex ?? 0, questionCount);
    const conversationHistory: LLMMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));

    const promptMessages = buildInterviewerPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interview: interview as any,
      conversationHistory,
      currentQuestionIndex,
    });

    const probing = buildIntegrityProbingSection(
      effectiveIntegrityConfig(interview as IntegrityConfigInput).integrityChecksEnabled,
      isChineseInterviewLanguage(String(interview.language ?? "")),
    );
    const systemMsg = promptMessages.find((m) => m.role === "system");
    if (probing && systemMsg && typeof systemMsg.content === "string") systemMsg.content += "\n" + probing;

    // Per-candidate tailoring (invite sessions only).
    if (sessionId) {
      const { data: cand } = await supabaseAdmin
        .from("candidates")
        .select("skills, tailorInterview, tailoredQuestions")
        .eq("sessionId", sessionId)
        .maybeSingle();
      if (cand && cand.tailorInterview !== false) {
        const section = buildCandidateFocusSection(
          { skills: cand.skills, questions: cand.tailoredQuestions },
          (interview.questions ?? []).length,
        );
        const sys = promptMessages.find((m) => m.role === "system");
        if (section && sys && typeof sys.content === "string") sys.content += "\n" + section;
      }
    }

    const response = await provider.generateResponse({
      messages: promptMessages,
      temperature: 0.7,
      maxTokens: 1024,
      // FailoverProvider.modelForEntry drops this when it doesn't fit the active provider.
      model: interview.llmModel ?? undefined,
    });

    void recordAiCallErrors({ sessionId, provider, source: "api/ai/chat" });

    const isComplete = response.content.includes("[INTERVIEW_COMPLETE]");
    const questionAdvanced = response.content.includes("[NEXT_QUESTION]");

    // Hindi is stored as Roman-script Hinglish, never Devanagari.
    const cleanContent = devanagariToRoman(
      response.content
        .replace("[INTERVIEW_COMPLETE]", "")
        .replace("[NEXT_QUESTION]", "")
        .trim(),
    );

    await supabaseAdmin.from("messages").insert({
      sessionId: access.sessionId,
      role: "ASSISTANT" as const,
      content: cleanContent,
      wordCount: cleanContent.split(/\s+/).length,
    });

    let nextQuestionIndex: number | undefined;
    if (questionAdvanced) {
      const questions = (interview.questions ?? []) as {
        id: string;
        skipIf?: unknown;
      }[];
      const priorUser = messages.filter((m) => m.role === "user").map((m) => m.content);
      nextQuestionIndex = nextAskableQuestionIndex(questions, currentQuestionIndex + 1, priorUser);
      const nextQuestion = questions[nextQuestionIndex];
      if (nextQuestion) {
        await supabaseAdmin
          .from("sessions")
          .update({ currentQuestionId: nextQuestion.id })
          .eq("id", access.sessionId);
      }
    }

    return NextResponse.json({
      content: cleanContent,
      questionAdvanced,
      isComplete,
      nextQuestionIndex,
    });
  } catch (error) {
    log.error("Chat AI error:", error);
    await recordAiCallErrors({ sessionId, provider, source: "api/ai/chat", finalError: error });
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 },
    );
  }
}
