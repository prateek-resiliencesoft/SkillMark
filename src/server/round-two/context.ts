import "server-only";
import { createLogger } from "@/lib/logger";
import { toBullets } from "@/lib/report-data";
import type { Round1Claim, Round1Context } from "@/lib/round-two/types";
import { getSessionOverallScore, type SessionScoreInsights } from "@/lib/session-score";
import type { Context } from "../context";
import { callJson, clip } from "./ai";

type Db = Context["supabase"];
const log = createLogger("round-two/context");

/**
 * Snapshot of round 1 used by the plan generator, copilot and report:
 * summary, score, candidate answers, CV, and AI-extracted claims to cross-check.
 */
export async function buildRound1Context(
  db: Db,
  organizationId: string,
  candidateId: string,
  sessionId: string | null,
): Promise<Round1Context> {
  const { data: candidate } = await db
    .from("candidates")
    .select("id, name, skills, profile, workExperience, interviewId")
    .eq("id", candidateId)
    .maybeSingle();

  const ctx: Round1Context = {};
  const profile = (candidate?.profile ?? null) as { resumeMarkdown?: string } | null;
  ctx.skills = Array.isArray(candidate?.skills) ? (candidate.skills as string[]).slice(0, 30) : [];
  ctx.resumeMarkdown = clip(profile?.resumeMarkdown || (candidate?.workExperience as string | null) || "", 8000) || undefined;

  const interviewId = candidate?.interviewId as string | undefined;
  if (interviewId) {
    const { data: interview } = await db.from("interviews").select("title, objective").eq("id", interviewId).maybeSingle();
    ctx.interviewTitle = (interview?.title as string | undefined) ?? undefined;
    ctx.objective = clip(interview?.objective as string | null, 1500) || undefined;
  }

  if (!sessionId) return ctx;

  const [{ data: session }, { data: messages }] = await Promise.all([
    db.from("sessions").select("summary, insights").eq("id", sessionId).maybeSingle(),
    db
      .from("messages")
      .select("role, content, createdAt")
      .eq("sessionId", sessionId)
      .in("role", ["USER", "ASSISTANT"])
      .order("createdAt", { ascending: true })
      .limit(400),
  ]);

  ctx.summary = clip(session?.summary as string | null, 4000) || undefined;
  ctx.overallScore = getSessionOverallScore(session?.insights as SessionScoreInsights);
  ctx.candidateAnswers = (messages ?? [])
    .filter((m) => m.role === "USER")
    .map((m) => clip(m.content as string, 1200))
    .filter((t) => t.length > 0)
    .slice(0, 60);

  const transcript = (messages ?? [])
    .map((m) => `${m.role === "USER" ? "Candidate" : "Interviewer"}: ${clip(m.content as string, 800)}`)
    .join("\n");

  try {
    const { data } = await callJson<{ strengths?: unknown; weaknesses?: unknown; claims?: unknown }>({
      organizationId,
      task: "report",
      maxTokens: 1500,
      temperature: 0.2,
      system:
        "You analyse a first-round interview so a human panel can run round 2. Return JSON: " +
        '{"strengths": string[] (max 6), "weaknesses": string[] (max 6, gaps worth probing), ' +
        '"claims": [{"claim": string, "evidence": string}] (max 12, concrete factual claims the candidate made about their experience, projects, tools, numbers — things that can be cross-checked)}. ' +
        "Only use what the transcript says.",
      messages: [
        {
          role: "user",
          content: `Summary:\n${ctx.summary ?? "(none)"}\n\nTranscript:\n${clip(transcript, 24_000)}`,
        },
      ],
    });
    const list = (v: unknown, n: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, n) : [];
    ctx.strengths = list(data.strengths, 6);
    ctx.weaknesses = list(data.weaknesses, 6);
    ctx.claims = Array.isArray(data.claims)
      ? (data.claims as unknown[])
          .map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            const claim = typeof o.claim === "string" ? o.claim.trim() : "";
            return claim ? ({ claim, evidence: typeof o.evidence === "string" ? clip(o.evidence, 300) : undefined } as Round1Claim) : null;
          })
          .filter((c): c is Round1Claim => c !== null)
          .slice(0, 12)
      : [];
  } catch (err) {
    log.warn("round 1 claim extraction failed; using summary bullets", err instanceof Error ? err.message : err);
    ctx.strengths = toBullets(ctx.summary, 4);
    ctx.weaknesses = [];
    ctx.claims = [];
  }
  return ctx;
}

export function round1ContextPrompt(ctx: Round1Context): string {
  const lines: string[] = [];
  if (ctx.interviewTitle) lines.push(`Role / interview: ${ctx.interviewTitle}`);
  if (ctx.objective) lines.push(`Objective: ${ctx.objective}`);
  if (ctx.overallScore != null) lines.push(`Round 1 score: ${ctx.overallScore.toFixed(1)} / 10`);
  if (ctx.summary) lines.push(`Round 1 summary: ${ctx.summary}`);
  if (ctx.strengths?.length) lines.push(`Strengths: ${ctx.strengths.join("; ")}`);
  if (ctx.weaknesses?.length) lines.push(`Weak areas: ${ctx.weaknesses.join("; ")}`);
  if (ctx.claims?.length) {
    lines.push("Round 1 claims to cross-check:");
    ctx.claims.forEach((c, i) => lines.push(`  C${i + 1}. ${c.claim}${c.evidence ? ` (quote: "${c.evidence}")` : ""}`));
  }
  if (ctx.skills?.length) lines.push(`CV skills: ${ctx.skills.join(", ")}`);
  if (ctx.resumeMarkdown) lines.push(`CV:\n${clip(ctx.resumeMarkdown, 4000)}`);
  return lines.join("\n");
}
