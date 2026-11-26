/**
 * Interview question-set generation / refinement as a LangGraph flow.
 *
 *   understand → extract_context? → draft ⇄ validate → review → END
 *
 * The draft node streams tokens to the caller exactly like the old route did
 * (`content` / `thinking` SSE events); every node also emits a reasoning step.
 */
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { extractGrounded, extractionsPrompt, type GroundedExtraction } from "../extract";
import { extractJson } from "../extract-json";
import { runGraph, skipStep, step } from "../graph/runtime";
import type { ReasoningStep } from "../graph/types";
import type { PremadeQuestionInput } from "../prompts/generator";
import type { LLMMessage, LLMProvider } from "../types";

const MAX_ATTEMPTS = 3;

type QuestionSet = { questions?: { text: string; type?: string; options?: unknown }[] } & Record<string, unknown>;

export type QuestionSetEvent =
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "status"; message: string }
  | { type: "step"; step: ReasoningStep };

const JD_CLASSES = [
  { name: "required_skill", description: "A skill, competency, tool, process or domain the role requires or prefers (include non-technical: hiring, people management, communication, compliance, etc.)" },
  { name: "responsibility", description: "Something the person in this role will do (projects, ownership areas, processes they run)" },
  { name: "qualification", description: "Experience level, degree, certification, years, or domain background required" },
];

const CV_CLASSES = [
  { name: "skill", description: "A skill, competency, tool, process or domain the candidate claims (technical or non-technical)" },
  { name: "experience", description: "A role, project or responsibility the candidate held (attributes: years, company)" },
  { name: "achievement", description: "A concrete, ideally measurable outcome the candidate claims" },
];

const State = Annotation.Root({
  mode: Annotation<"generate" | "refine">(),
  messages: Annotation<LLMMessage[]>(),
  jobDescription: Annotation<string>(),
  resumeText: Annotation<string>(),
  premadeQuestions: Annotation<PremadeQuestionInput[]>(),
  evidence: Annotation<GroundedExtraction[]>(),
  raw: Annotation<string>(),
  attempts: Annotation<number>(),
  parseError: Annotation<string | null>(),
  result: Annotation<QuestionSet | null>(),
});
type S = typeof State.State;

function hasDocs(s: S) {
  return !!(s.jobDescription.trim() || s.resumeText.trim());
}

function words(t: string): Set<string> {
  return new Set(t.toLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu) ?? []);
}

/** JD requirements no question mentions (≥1 distinctive word shared). */
function uncoveredRequirements(evidence: GroundedExtraction[], questions: { text: string }[]): string[] {
  const qWords = words(questions.map((q) => q.text).join(" "));
  const STOP = new Set(["and", "the", "with", "for", "experience", "knowledge", "skills", "ability", "strong", "years", "working"]);
  return evidence
    .filter((e) => e.class === "required_skill")
    .filter((e) => ![...words(e.text)].some((w) => !STOP.has(w) && qWords.has(w)))
    .map((e) => e.text);
}

function buildGraph(provider: LLMProvider, model: string | undefined, emit: (e: QuestionSetEvent) => void, organizationId?: string | null) {
  const understand = step<S, Partial<S>>("understand", "Reading the brief", (s, ctx) => {
    const parts = [
      s.mode === "refine" ? "Refining the current set with your feedback" : "New question set",
      s.jobDescription.trim() ? "job description attached" : null,
      s.resumeText.trim() ? "CV attached" : null,
      s.premadeQuestions.length ? `${s.premadeQuestions.length} premade question(s) to keep word-for-word` : null,
    ].filter(Boolean);
    ctx.note(parts.join(" · "));
    return {};
  });

  const extractContext = step<S, Partial<S>>("extract_context", "Pulling key facts from the JD and CV", async (s, ctx) => {
    const jobs = [
      s.jobDescription.trim()
        ? extractGrounded({
            source: s.jobDescription,
            sourceId: "jd",
            classes: JD_CLASSES,
            instructions: "The source is a job description. Extract what the role requires.",
            organizationId,
            task: "resume",
            signal: ctx.signal,
          })
        : null,
      s.resumeText.trim()
        ? extractGrounded({
            source: s.resumeText,
            sourceId: "cv",
            classes: CV_CLASSES,
            instructions: "The source is a candidate CV. Extract what the candidate claims.",
            organizationId,
            task: "resume",
            signal: ctx.signal,
          })
        : null,
    ];
    const settled = await Promise.allSettled(jobs.map((j) => j ?? Promise.resolve(null)));
    const evidence: GroundedExtraction[] = [];
    const notes: string[] = [];
    settled.forEach((r, i) => {
      const what = i === 0 ? "JD" : "CV";
      if (r.status === "rejected") notes.push(`${what}: extraction failed, continuing without it`);
      else if (r.value) {
        evidence.push(...r.value.items);
        notes.push(`${what}: ${r.value.items.length} grounded fact(s)${r.value.dropped ? `, ${r.value.dropped} unverifiable dropped` : ""}`);
      }
    });
    ctx.note(notes.join(" · "));
    const sample = evidence.slice(0, 8).map((e) => `[${e.class}] ${e.text}`);
    if (sample.length) ctx.think(`Key evidence:\n${sample.join("\n")}`);
    return { evidence };
  });

  const draft = step<S, Partial<S>>(
    "draft",
    (s) => (s.attempts > 0 ? `Re-drafting (attempt ${s.attempts + 1} of ${MAX_ATTEMPTS})` : s.mode === "refine" ? "Rewriting the question set" : "Drafting the question set"),
    async (s, ctx) => {
      const streamToClient = s.attempts === 0;
      if (s.attempts > 0) emit({ type: "status", message: `Output was malformed, retrying (${s.attempts + 1}/${MAX_ATTEMPTS})…` });
      const messages = s.messages.map((m) => ({ ...m }));
      const sys = messages.find((m) => m.role === "system");
      if (sys && typeof sys.content === "string") {
        if (s.mode === "refine") {
          sys.content +=
            "\n\nREFINE MODE: User feedback in the user message is the highest-priority directive. If it asks for a different role or focus (e.g. HR/hiring/management), rewrite the whole set for that focus; do not preserve conflicting technical questions just because they appear in the current set or in document evidence.\n";
        }
        if (s.evidence.length) {
          sys.content += `\n\nEVIDENCE EXTRACTED FROM THE DOCUMENTS (verbatim quotes; use when they support the brief/feedback; ignore when they conflict with refine feedback):\n${extractionsPrompt(s.evidence, 50)}\n`;
        }
      }
      let inThink = false;
      let content = "";
      for await (const chunk of provider.streamResponse({ messages, temperature: 0.7, maxTokens: 8192, model, signal: ctx.signal })) {
        let rest = chunk;
        while (rest.length > 0) {
          if (inThink) {
            const end = rest.indexOf("</think>");
            const piece = end >= 0 ? rest.slice(0, end) : rest;
            if (piece && streamToClient) emit({ type: "thinking", text: piece });
            if (end >= 0) {
              inThink = false;
              rest = rest.slice(end + 8);
            } else rest = "";
          } else {
            const start = rest.indexOf("<think>");
            const piece = start >= 0 ? rest.slice(0, start) : rest;
            if (piece) {
              content += piece;
              if (streamToClient) emit({ type: "content", text: piece });
            }
            if (start >= 0) {
              inThink = true;
              rest = rest.slice(start + 7);
            } else rest = "";
          }
        }
      }
      ctx.note(`${content.length.toLocaleString()} characters written`);
      return { raw: content, attempts: s.attempts + 1 };
    },
  );

  const validate = step<S, Partial<S>>("validate", "Checking the output is valid", (s, ctx) => {
    try {
      const parsed = extractJson<QuestionSet>(s.raw);
      if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) throw new Error("no questions in output");
      ctx.note(`${parsed.questions.length} questions parsed`);
      return { result: parsed, parseError: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.note(`Malformed output: ${msg}`);
      return { result: null, parseError: msg };
    }
  });

  const review = step<S, Partial<S>>("review", "Reviewing coverage", async (s, ctx) => {
    const result = s.result as QuestionSet;
    const questions = result.questions ?? [];
    const notes: string[] = [];
    if (s.premadeQuestions.length) {
      const { enforceExactPremadeQuestions } = await import("@/lib/question-conditions");
      result.questions = enforceExactPremadeQuestions(questions, s.premadeQuestions as Parameters<typeof enforceExactPremadeQuestions>[1]);
      notes.push(`${s.premadeQuestions.length} premade question(s) kept word-for-word`);
    }
    const missingOptions = (result.questions ?? []).filter((q) => {
      if (q.type !== "SINGLE_CHOICE" && q.type !== "MULTIPLE_CHOICE") return false;
      const opts = q.options;
      const list = Array.isArray(opts)
        ? opts
        : opts && typeof opts === "object" && Array.isArray((opts as { options?: unknown }).options)
          ? (opts as { options: unknown[] }).options
          : null;
      return !(list && list.length >= 2);
    }).length;
    if (missingOptions) notes.push(`${missingOptions} choice question(s) missing options — check before saving`);
    const reqs = s.evidence.filter((e) => e.class === "required_skill");
    if (reqs.length) {
      const gaps = uncoveredRequirements(s.evidence, result.questions ?? []);
      notes.push(`Covers ${reqs.length - gaps.length}/${reqs.length} JD requirements`);
      if (gaps.length) ctx.think(`Not directly asked about yet:\n${gaps.slice(0, 10).map((g) => `- ${g}`).join("\n")}`);
    }
    const types = new Map<string, number>();
    for (const q of result.questions ?? []) types.set(q.type ?? "OPEN_ENDED", (types.get(q.type ?? "OPEN_ENDED") ?? 0) + 1);
    notes.push([...types].map(([t, n]) => `${n} ${t.toLowerCase().replace("_", " ")}`).join(", "));
    ctx.note(notes.join(" · "));
    return { result };
  });

  return new StateGraph(State)
    .addNode("understand", understand)
    .addNode("extract_context", extractContext)
    .addNode("draft", draft)
    .addNode("validate", validate)
    .addNode("review", review)
    .addEdge(START, "understand")
    .addConditionalEdges(
      "understand",
      (s: S, config: LangGraphRunnableConfig) => {
        if (hasDocs(s)) return "extract_context";
        skipStep(config, "extract_context", "Pulling key facts from the JD and CV", "No JD or CV attached");
        return "draft";
      },
      ["extract_context", "draft"],
    )
    .addEdge("extract_context", "draft")
    .addEdge("draft", "validate")
    .addConditionalEdges("validate", (s: S) => (s.result ? "review" : s.attempts < MAX_ATTEMPTS ? "draft" : END), ["review", "draft", END])
    .addEdge("review", END)
    .compile();
}

export async function runQuestionSetFlow(opts: {
  mode: "generate" | "refine";
  messages: LLMMessage[];
  provider: LLMProvider;
  model?: string;
  jobDescription?: string;
  resumeText?: string;
  premadeQuestions?: PremadeQuestionInput[];
  organizationId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  emit: (e: QuestionSetEvent) => void;
  signal?: AbortSignal;
}): Promise<{ result: QuestionSet; runId: string | null; steps: ReasoningStep[] }> {
  const graph = buildGraph(opts.provider, opts.model, opts.emit, opts.organizationId);
  const r = await runGraph<S>(graph, {
    flow: opts.mode === "refine" ? "question-refine" : "question-generation",
    input: {
      mode: opts.mode,
      messages: opts.messages,
      jobDescription: opts.jobDescription ?? "",
      resumeText: opts.resumeText ?? "",
      premadeQuestions: Array.isArray(opts.premadeQuestions) ? opts.premadeQuestions : [],
      evidence: [],
      raw: "",
      attempts: 0,
      parseError: null,
      result: null,
    },
    organizationId: opts.organizationId,
    userId: opts.userId,
    subject: opts.projectId ? { type: "project", id: opts.projectId } : undefined,
    onStep: (step) => opts.emit({ type: "step", step }),
    signal: opts.signal,
    traceInput: {
      mode: opts.mode,
      hasJobDescription: !!opts.jobDescription,
      hasResume: !!opts.resumeText,
      premade: opts.premadeQuestions?.length ?? 0,
    },
  });
  if (!r.state.result) throw new Error(r.state.parseError ?? "Failed to parse AI response after retries");
  return { result: r.state.result, runId: r.runId, steps: r.steps };
}

/** SSE response that runs the flow and streams its events. */
export function questionSetSse(
  run: (emit: (e: QuestionSetEvent) => void, signal: AbortSignal) => Promise<{ result: QuestionSet; runId: string | null }>,
  onError: (err: unknown) => string,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const { result, runId } = await run((e) => send(e as unknown as Record<string, unknown>), abort.signal);
        send({ type: "done", data: result, runId });
      } catch (err) {
        send({ type: "error", message: onError(err) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
