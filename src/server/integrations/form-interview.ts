import { resolveTaskModels } from "@/lib/ai/registry";
import { buildGeneratorPrompt } from "@/lib/ai/prompts/generator";
import type { InterviewConfig } from "@/lib/forms/schema";
import { supabaseAdmin } from "@/lib/supabase/admin";

type GeneratedQuestion = {
  text?: string;
  type?: string;
  description?: string;
  options?: unknown;
  starterCode?: unknown;
};

const QUESTION_TYPES = new Set(["OPEN_ENDED", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "CODING", "WHITEBOARD", "RESEARCH"]);

function parseJsonLoose(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI response was not JSON");
  return JSON.parse(m[0]);
}

export function describeConfig(c: InterviewConfig): string {
  const parts = [
    `A ${c.durationMinutes ?? 20}-minute ${c.interviewType ?? "technical"} interview`,
    c.jobRole ? `for a ${c.experienceLevel ?? ""} ${c.jobRole}`.replace(/\s+/g, " ") : "",
    c.difficulty ? `at ${c.difficulty} difficulty` : "",
    c.numberOfQuestions ? `with about ${c.numberOfQuestions} questions` : "",
    c.categories?.length ? `covering ${c.categories.join(", ")} topics` : "",
  ].filter(Boolean);
  let s = parts.join(" ") + ".";
  if (c.description) s += ` ${c.description}`;
  if (c.evaluationCriteria?.length)
    s += ` Evaluate on: ${c.evaluationCriteria.map((e) => `${e.name}${e.weight ? ` (weight ${e.weight})` : ""}${e.description ? ` – ${e.description}` : ""}`).join("; ")}.`;
  if (c.instructions) s += ` Interviewer instructions: ${c.instructions}`;
  return s;
}

/** Generate questions with the same prompt/provider as /api/ai/generate. */
export async function generateQuestions(c: InterviewConfig, organizationId?: string | null) {
  const { provider, generatorModel } = await resolveTaskModels(organizationId);
  const premade = (c.predefinedQuestions ?? []).filter((q) => q.trim()).map((text) => ({ text, type: "OPEN_ENDED" }));
  const messages = buildGeneratorPrompt(
    describeConfig(c),
    c.durationMinutes,
    c.language,
    c.jobDescription || undefined,
    undefined,
    premade.length ? (premade as never) : undefined,
  );
  let full = "";
  for await (const chunk of provider.streamResponse({ messages, temperature: 0.7, maxTokens: 8192, model: generatorModel })) {
    full += chunk;
  }
  const json = parseJsonLoose(full);
  const qs = (Array.isArray(json.questions) ? json.questions : []) as GeneratedQuestion[];
  return {
    objective: typeof json.objective === "string" ? json.objective : null,
    assessmentCriteria: Array.isArray(json.assessmentCriteria) ? json.assessmentCriteria : null,
    questions: qs.filter((q) => q?.text),
  };
}

/**
 * Create or update the interview backing a form from its InterviewConfig.
 * Questions are (re)generated only when `regenerate` is true or none exist.
 */
export async function syncFormInterview(opts: {
  form: { id: string; interviewId: string | null; projectId: string | null; userId: string };
  config: InterviewConfig;
  regenerate?: boolean;
}) {
  const { form, config: c } = opts;
  if (!c.title?.trim()) throw new Error("Interview title is required");
  if (!form.projectId) throw new Error("Form has no project");

  const objectiveParts = [c.jobRole ? `Role: ${c.jobRole}` : "", c.jobDescription ? `Job description:\n${c.jobDescription}` : "", c.instructions ? `Instructions: ${c.instructions}` : ""].filter(Boolean);
  const voice = (c.mode ?? "voice") === "voice";
  const row: Record<string, unknown> = {
    title: c.title.trim(),
    description: c.description || null,
    language: c.language || "en",
    timeLimitMinutes: c.durationMinutes || null,
    voiceEnabled: voice,
    chatEnabled: true,
    mode: voice ? "VOICE" : "CHAT",
    antiCheatingEnabled: !!c.antiCheatingEnabled,
    headMovementDetectionEnabled: !!c.antiCheatingEnabled && !!c.headMovementDetectionEnabled,
    requireInvite: true,
    updatedAt: new Date().toISOString(),
  };
  if (c.evaluationCriteria?.length)
    row.assessmentCriteria = c.evaluationCriteria.map((e) => ({ name: e.name, description: e.description ?? "", weight: e.weight ?? 1 }));

  let interviewId = form.interviewId;
  if (interviewId) {
    const { data: exists } = await supabaseAdmin.from("interviews").select("id").eq("id", interviewId).maybeSingle();
    if (!exists) interviewId = null;
  }
  if (!interviewId) {
    const { data, error } = await supabaseAdmin
      .from("interviews")
      .insert({ ...row, userId: form.userId, projectId: form.projectId, objective: objectiveParts.join("\n\n") || null })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message || "Failed to create interview");
    interviewId = data.id as string;
    await supabaseAdmin.from("interview_forms").update({ interviewId }).eq("id", form.id);
  } else {
    await supabaseAdmin.from("interviews").update(row).eq("id", interviewId);
  }

  const { count } = await supabaseAdmin.from("questions").select("id", { count: "exact", head: true }).eq("interviewId", interviewId);
  let questionCount = count ?? 0;

  if (opts.regenerate || questionCount === 0) {
    let questions: GeneratedQuestion[];
    let objective: string | null = null;
    if ((c.questionSource ?? "ai") === "predefined") {
      questions = (c.predefinedQuestions ?? []).filter((q) => q.trim()).map((text) => ({ text, type: "OPEN_ENDED" }));
      if (!questions.length) throw new Error("Add at least one predefined question");
    } else {
      let organizationId: string | null = null;
      if (form.projectId) {
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("organizationId")
          .eq("id", form.projectId)
          .maybeSingle();
        organizationId = (project?.organizationId as string | undefined) ?? null;
      }
      const g = await generateQuestions(c, organizationId);
      questions = g.questions;
      objective = g.objective;
      if (g.assessmentCriteria && !c.evaluationCriteria?.length)
        await supabaseAdmin.from("interviews").update({ assessmentCriteria: g.assessmentCriteria }).eq("id", interviewId);
      if (!questions.length) throw new Error("AI returned no questions");
    }
    if (c.numberOfQuestions && (c.questionSource ?? "ai") === "ai") questions = questions.slice(0, Math.max(c.numberOfQuestions, (c.predefinedQuestions ?? []).length));
    await supabaseAdmin.from("questions").delete().eq("interviewId", interviewId);
    const rows = questions.map((q, i) => ({
      interviewId,
      order: i,
      text: String(q.text),
      description: q.description ?? null,
      type: QUESTION_TYPES.has(String(q.type)) ? q.type : "OPEN_ENDED",
      options: q.options ?? null,
      starterCode: q.starterCode ?? null,
      isRequired: true,
    }));
    const { error } = await supabaseAdmin.from("questions").insert(rows);
    if (error) throw new Error(error.message);
    questionCount = rows.length;
    const obj = [objectiveParts.join("\n\n"), objective].filter(Boolean).join("\n\n");
    if (obj) await supabaseAdmin.from("interviews").update({ objective: obj }).eq("id", interviewId);
  }

  return { interviewId: interviewId as string, questionCount };
}
