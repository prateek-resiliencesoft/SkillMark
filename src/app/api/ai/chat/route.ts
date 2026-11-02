import { buildInterviewerPrompt } from "@/lib/ai/prompts/interviewer";
import { buildCandidateFocusSection } from "@/lib/ai/prompts/candidate-focus";
import { resolveProvider } from "@/lib/ai/registry";
import { taskFromFollowUpDepth } from "@/lib/ai/credentials";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ai/chat");
import type { LLMMessage } from "@/lib/ai/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { sessionId, interviewId, messages, currentQuestionIndex } =
    await req.json();

  try {
    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("*, questions(*), project:projects(organizationId)")
      .eq("id", interviewId)
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
    const provider = await resolveProvider({
      organizationId,
      idOrModel: interview.llmProvider,
      task: taskFromFollowUpDepth(interview.followUpDepth as string | undefined),
    });

    const conversationHistory: LLMMessage[] = messages.map(
      (m: { role: "user" | "assistant"; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }),
    );

    const promptMessages = buildInterviewerPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interview: interview as any,
      conversationHistory,
      currentQuestionIndex: currentQuestionIndex ?? 0,
    });

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

    const isComplete = response.content.includes("[INTERVIEW_COMPLETE]");
    const questionAdvanced = response.content.includes("[NEXT_QUESTION]");

    const cleanContent = response.content
      .replace("[INTERVIEW_COMPLETE]", "")
      .replace("[NEXT_QUESTION]", "")
      .trim();

    await supabaseAdmin.from("messages").insert({
      sessionId,
      role: "ASSISTANT" as const,
      content: cleanContent,
      wordCount: cleanContent.split(/\s+/).length,
    });

    if (questionAdvanced) {
      const nextIndex = (currentQuestionIndex ?? 0) + 1;
      const questions = (interview.questions ?? []) as { id: string }[];
      const nextQuestion = questions[nextIndex];
      if (nextQuestion) {
        await supabaseAdmin
          .from("sessions")
          .update({ currentQuestionId: nextQuestion.id })
          .eq("id", sessionId);
      }
    }

    return NextResponse.json({
      content: cleanContent,
      questionAdvanced,
      isComplete,
    });
  } catch (error) {
    log.error("Chat AI error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 },
    );
  }
}
