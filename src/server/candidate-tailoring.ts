import "server-only";
import { extractJson } from "@/lib/ai/extract-json";
import { resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import type { Context } from "./context";

const log = createLogger("candidate-tailoring");
type Db = Context["supabase"];

export interface TailoredQuestion {
  text: string;
  skill?: string | null;
}

/** ~25% of the base script (min 1, max 4) is tailored to the resume. */
export function tailoredCount(baseCount: number): number {
  return Math.max(1, Math.min(4, Math.round(Math.max(baseCount, 4) * 0.25)));
}

export function normalizeSkills(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of skills) {
    if (typeof s !== "string") continue;
    const t = s.trim().slice(0, 60);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 30);
}

function fallbackQuestions(skills: string[], n: number): TailoredQuestion[] {
  const tpl = [
    (s: string) => `Your resume mentions ${s}. Walk me through a project where you used it — what was your role and what was the hardest part?`,
    (s: string) => `How have you applied ${s} in practice, and what trade-offs or mistakes taught you the most?`,
    (s: string) => `If you had to explain how you'd use ${s} to solve a real problem on this team, how would you approach it?`,
  ];
  return skills.slice(0, n).map((s, i) => ({ text: tpl[i % tpl.length](s), skill: s }));
}

/** Never throws; falls back to template questions when no AI key / model error. */
export async function generateTailoredQuestions(opts: {
  organizationId: string | null;
  interview: { title: string; objective?: string | null; language?: string | null };
  baseQuestions: string[];
  skills: string[];
  workExperience?: string | null;
  notes?: string | null;
}): Promise<TailoredQuestion[]> {
  const skills = normalizeSkills(opts.skills);
  if (!skills.length) return [];
  const n = tailoredCount(opts.baseQuestions.length);
  try {
    const { provider, generatorModel } = await resolveTaskModels(opts.organizationId);
    const prompt = `You tailor an existing interview to one candidate.
Interview: "${opts.interview.title}"${opts.interview.objective ? `\nObjective: ${opts.interview.objective}` : ""}
Language: ${opts.interview.language || "en"}
Existing script questions (keep their topics, don't duplicate them):
${opts.baseQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") || "(none)"}

Candidate skills from resume: ${skills.join(", ")}
${opts.workExperience ? `Experience: ${opts.workExperience}\n` : ""}${opts.notes ? `Summary: ${opts.notes.slice(0, 500)}\n` : ""}
Write exactly ${n} short, spoken-friendly open-ended questions that probe the candidate's real hands-on experience with the skills most relevant to this interview. Write them in the interview language.
Return ONLY JSON: {"questions":[{"text":"...","skill":"..."}]}`;
    const res = await provider.generateResponse({
      messages: [{ role: "user", content: prompt }],
      model: generatorModel,
      temperature: 0.5,
      maxTokens: 1024,
    });
    const parsed = extractJson<{ questions?: TailoredQuestion[] }>(
      res.content.replace(/<think>[\s\S]*?<\/think>/g, ""),
    );
    const qs = (parsed.questions ?? [])
      .filter((q) => q && typeof q.text === "string" && q.text.trim())
      .map((q) => ({ text: q.text.trim().slice(0, 400), skill: q.skill ? String(q.skill).slice(0, 60) : null }))
      .slice(0, n);
    if (qs.length) return qs;
  } catch (err) {
    log.warn("Tailored question generation failed, using fallback", err);
  }
  return fallbackQuestions(skills, n);
}

/** Generate + store tailored questions for candidates (sequential, small batches). Never throws. */
export async function tailorCandidates(
  supabase: Db,
  organizationId: string,
  interviewId: string,
  candidates: { id: string; skills?: string[] | null; tailorInterview?: boolean | null; workExperience?: string | null; notes?: string | null }[],
): Promise<void> {
  const todo = candidates.filter((c) => c.tailorInterview !== false && (c.skills?.length ?? 0) > 0);
  if (!todo.length) return;
  try {
    const { data: interview } = await supabase
      .from("interviews")
      .select("title, objective, language, questions(text, order)")
      .eq("id", interviewId)
      .single();
    if (!interview) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = ((interview.questions as any[]) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((q) => String(q.text));
    const queue = [...todo];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const qs = await generateTailoredQuestions({
          organizationId,
          interview: { title: interview.title, objective: interview.objective, language: interview.language },
          baseQuestions: base,
          skills: c.skills ?? [],
          workExperience: c.workExperience,
          notes: c.notes,
        });
        await supabase.from("candidates").update({ tailoredQuestions: qs.length ? qs : null }).eq("id", c.id);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (err) {
    log.warn("tailorCandidates failed", err);
  }
}
