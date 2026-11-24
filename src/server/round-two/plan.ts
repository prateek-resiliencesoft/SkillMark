import "server-only";
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { extractGrounded } from "@/lib/ai/extract";
import { runGraph, skipStep, step } from "@/lib/ai/graph/runtime";
import type { ReasoningStep } from "@/lib/ai/graph/types";
import { normalizePlan, type GroundedClaim, type QuestionPlanItem, type Round1Context } from "@/lib/round-two/types";
import { callJson, clip } from "./ai";
import { planGaps } from "./checks";
import { round1ContextPrompt } from "./context";

const SYSTEM = `You help a hiring panel prepare a live, human-led round 2 interview.
The candidate already passed an AI-led round 1. Build a question plan that:
- probes round 1 weak areas and vague answers,
- cross-checks concrete round 1 claims and CV claims (ask for specifics: numbers, decisions, trade-offs),
- adds role-relevant technical and behavioural depth,
- fits the time budget.
Each question gets 1-3 sharp follow-ups. Categories: technical, behavioral, probe_round1, cv_claim, culture, other.
Return JSON: {"reply": string (short message to the recruiter about what you built or changed), "reasoning": string (3-6 short "- " bullets: why these questions, what you prioritised), "plan": [{"id": string, "text": string, "category": string, "rationale": string, "followUps": string[], "minutes": number}]}.
When the recruiter asks for changes, return the FULL updated plan, keeping ids of unchanged questions.`;

const CV_CLASSES = [
  { name: "skill", description: "A skill, tool or technology the candidate claims" },
  { name: "experience", description: "A role, project or responsibility the candidate held (attributes: years, company)" },
  { name: "achievement", description: "A concrete, ideally measurable outcome the candidate claims" },
];

const State = Annotation.Root({
  organizationId: Annotation<string>(),
  context: Annotation<Round1Context>(),
  durationMin: Annotation<number>(),
  currentPlan: Annotation<QuestionPlanItem[]>(),
  history: Annotation<{ role: "user" | "assistant"; content: string }[]>(),
  instruction: Annotation<string>(),
  cvClaims: Annotation<GroundedClaim[]>(),
  reply: Annotation<string>(),
  plan: Annotation<QuestionPlanItem[]>(),
  gaps: Annotation<string[]>(),
  revised: Annotation<boolean>(),
});
type S = typeof State.State;

function claimsBlock(claims: GroundedClaim[]): string {
  return claims.length ? `Verbatim CV claims (verify the important ones):\n${claims.slice(0, 30).map((c) => `- [${c.class}] "${c.text}"`).join("\n")}` : "";
}

function seed(s: S): string {
  return [
    `Interview length: ${s.durationMin} minutes.`,
    round1ContextPrompt(s.context),
    claimsBlock(s.cvClaims),
    s.currentPlan.length ? `Current plan:\n${JSON.stringify(s.currentPlan)}` : "No plan yet.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildGraph() {
  const gather = step<S, Partial<S>>("gather", "Reading round 1 results and the CV", (s, ctx) => {
    const c = s.context;
    ctx.note(
      [
        c.overallScore != null ? `Round 1 score ${c.overallScore}` : null,
        `${c.strengths?.length ?? 0} strengths`,
        `${c.weaknesses?.length ?? 0} weak areas`,
        `${c.claims?.length ?? 0} round 1 claims`,
        c.resumeMarkdown ? "CV available" : "no CV",
        s.currentPlan.length ? `editing a ${s.currentPlan.length}-question plan` : "no plan yet",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    return {};
  });

  const extractCv = step<S, Partial<S>>("extract_cv", "Pulling verifiable claims from the CV", async (s, ctx) => {
    try {
      const r = await extractGrounded({
        source: s.context.resumeMarkdown ?? "",
        sourceId: "cv",
        classes: CV_CLASSES,
        instructions: "The source is a candidate CV. Extract what the candidate claims, so a panel can verify it.",
        organizationId: s.organizationId,
        task: "resume",
        maxChunkChars: 8_000,
        signal: ctx.signal,
      });
      const cvClaims = r.items.map((x) => ({ class: x.class, text: x.text, attributes: x.attributes, start: x.start, end: x.end }));
      ctx.note(`${cvClaims.length} grounded claim(s)${r.dropped ? `, ${r.dropped} unverifiable dropped` : ""}`);
      return { cvClaims };
    } catch (err) {
      ctx.note(`CV extraction failed (${err instanceof Error ? err.message : "error"}); continuing without it`);
      return { cvClaims: [] };
    }
  });

  const draft = step<S, Partial<S>>(
    "draft",
    (s) => (s.currentPlan.length && s.instruction ? "Applying your change" : "Drafting the question plan"),
    async (s, ctx) => {
      const { data } = await callJson<{ reply?: unknown; plan?: unknown; reasoning?: unknown }>({
        organizationId: s.organizationId,
        task: "generate",
        maxTokens: 3500,
        temperature: 0.5,
        system: SYSTEM,
        messages: [
          { role: "user", content: seed(s) },
          ...s.history.slice(-12).map((m) => ({ role: m.role, content: clip(m.content, 4000) })),
          { role: "user", content: s.instruction || "Draft the round 2 question plan." },
        ],
        signal: ctx.signal,
      });
      const plan = normalizePlan(data.plan);
      if (plan.length === 0) throw new Error("The AI did not return any questions. Try rephrasing.");
      if (typeof data.reasoning === "string") ctx.think(clip(data.reasoning, 2000));
      ctx.note(`${plan.length} questions, ~${plan.reduce((n, q) => n + (q.minutes ?? 0), 0)} min`);
      return { plan, reply: typeof data.reply === "string" ? clip(data.reply, 1500) : "Here is the plan." };
    },
  );

  const critique = step<S, Partial<S>>("critique", "Checking coverage of round 1 and CV", (s, ctx) => {
    const gaps = planGaps(s.plan, s.context, s.cvClaims, s.durationMin);
    ctx.note(gaps.length ? `${gaps.length} gap(s) found` : "Covers round 1 weak areas, claims and the time budget");
    if (gaps.length) ctx.think(gaps.map((g) => `- ${g}`).join("\n"));
    return { gaps };
  });

  const revise = step<S, Partial<S>>("revise", "Filling the gaps", async (s, ctx) => {
    const { data } = await callJson<{ reply?: unknown; plan?: unknown; reasoning?: unknown }>({
      organizationId: s.organizationId,
      task: "generate",
      maxTokens: 3500,
      temperature: 0.4,
      system: SYSTEM,
      messages: [
        { role: "user", content: seed({ ...s, currentPlan: s.plan }) },
        {
          role: "user",
          content: `Revise the plan to close these gaps while keeping the recruiter's intent${s.instruction ? ` ("${clip(s.instruction, 500)}")` : ""}. Keep ids of questions you keep. Gaps:\n${s.gaps.map((g) => `- ${g}`).join("\n")}`,
        },
      ],
      signal: ctx.signal,
    });
    const plan = normalizePlan(data.plan);
    if (!plan.length) {
      ctx.note("Revision returned nothing; keeping the draft");
      return { revised: true };
    }
    if (typeof data.reasoning === "string") ctx.think(clip(data.reasoning, 2000));
    const left = planGaps(plan, s.context, s.cvClaims, s.durationMin);
    ctx.note(`${s.gaps.length - Math.min(s.gaps.length, left.length)} of ${s.gaps.length} gap(s) closed`);
    return { plan, revised: true, gaps: left, reply: typeof data.reply === "string" ? clip(data.reply, 1500) : s.reply };
  });

  return new StateGraph(State)
    .addNode("gather", gather)
    .addNode("extract_cv", extractCv)
    .addNode("draft", draft)
    .addNode("critique", critique)
    .addNode("revise", revise)
    .addEdge(START, "gather")
    .addConditionalEdges(
      "gather",
      (s: S, config: LangGraphRunnableConfig) => {
        if (s.context.resumeMarkdown?.trim() && !s.cvClaims.length) return "extract_cv";
        skipStep(config, "extract_cv", "Pulling verifiable claims from the CV", s.cvClaims.length ? `Using ${s.cvClaims.length} cached CV claim(s)` : "No CV on file");
        return "draft";
      },
      ["extract_cv", "draft"],
    )
    .addEdge("extract_cv", "draft")
    .addEdge("draft", "critique")
    .addConditionalEdges(
      "critique",
      (s: S, config: LangGraphRunnableConfig) => {
        if (s.gaps.length && !s.revised) return "revise";
        if (s.gaps.length) skipStep(config, "revise", "Filling the gaps", "Already revised once; showing remaining gaps");
        return END;
      },
      ["revise", END],
    )
    .addEdge("revise", END)
    .compile();
}

export async function generateQuestionPlan(opts: {
  roundTwoId: string;
  organizationId: string;
  userId?: string;
  context: Round1Context;
  durationMin: number;
  currentPlan: QuestionPlanItem[];
  history: { role: "user" | "assistant"; content: string }[];
  instruction: string;
}): Promise<{ reply: string; plan: QuestionPlanItem[]; gaps: string[]; cvClaims: GroundedClaim[]; steps: ReasoningStep[]; runId: string | null }> {
  const r = await runGraph<S>(buildGraph(), {
    flow: "round2-plan",
    organizationId: opts.organizationId,
    userId: opts.userId,
    subject: { type: "round_two", id: opts.roundTwoId },
    traceInput: { instruction: opts.instruction, durationMin: opts.durationMin, currentPlan: opts.currentPlan.length },
    input: {
      organizationId: opts.organizationId,
      context: opts.context,
      durationMin: opts.durationMin,
      currentPlan: opts.currentPlan,
      history: opts.history,
      instruction: opts.instruction,
      cvClaims: opts.context.cvClaims ?? [],
      reply: "",
      plan: [],
      gaps: [],
      revised: false,
    },
  });
  const s = r.state;
  return { reply: s.reply, plan: s.plan, gaps: s.gaps, cvClaims: s.cvClaims, steps: r.steps, runId: r.runId };
}
