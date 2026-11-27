/**
 * LangGraph runtime shared by every AI flow.
 *
 * - `step()` wraps a graph node: it times the node, opens a Langfuse span for it,
 *   collects token usage and `<think>` text from LLM calls made inside it, and
 *   emits a ReasoningStep on LangGraph's `custom` stream.
 * - `runGraph()` runs a compiled graph as one Langfuse trace, forwards steps to
 *   the caller (SSE) and persists the timeline to `ai_runs`.
 */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { getActiveTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { ROOT_CONTEXT, context } from "@opentelemetry/api";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { flowScope, stepUsage, tracingEnabled, type StepUsage } from "../tracing";
import type { AiFlow, ReasoningStep } from "./types";

const log = createLogger("ai/graph");

export interface StepCtx {
  /** Plain-language outcome shown in the timeline. */
  note(detail: string): void;
  /** Model rationale to show under the step. */
  think(text: string): void;
  signal?: AbortSignal;
}

interface RunHandle {
  nextId(node: string): string;
  signal?: AbortSignal;
}

const STEP_EVENT = "aiStep";

const AI_RUN_RETENTION_DAYS = Number(process.env.AI_RUN_RETENTION_DAYS) || 90;
let lastPrune = 0;

/** Drops ai_runs older than AI_RUN_RETENTION_DAYS (at most hourly). */
export async function pruneAiRuns(): Promise<void> {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  const cutoff = new Date(Date.now() - AI_RUN_RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await supabaseAdmin.from("ai_runs").delete().lt("startedAt", cutoff);
  if (error) log.warn("ai_runs prune failed", error.message);
}

type StepEvent = { [STEP_EVENT]: ReasoningStep };

function isStepEvent(v: unknown): v is StepEvent {
  return !!v && typeof v === "object" && STEP_EVENT in v;
}

function runHandle(config: LangGraphRunnableConfig): RunHandle | undefined {
  return (config.configurable as { aiRun?: RunHandle } | undefined)?.aiRun;
}

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Wrap a node function so it shows up as a reasoning step (UI + Langfuse). */
export function step<S, U>(
  node: string,
  label: string | ((state: S) => string),
  fn: (state: S, ctx: StepCtx) => Promise<U> | U,
): (state: S, config: LangGraphRunnableConfig) => Promise<U> {
  return async (state, config) => {
    const handle = runHandle(config);
    const s: ReasoningStep = {
      id: handle?.nextId(node) ?? node,
      node,
      label: typeof label === "function" ? label(state) : label,
      status: "running",
      startedAt: Date.now(),
    };
    const emit = () => config.writer?.({ [STEP_EVENT]: { ...s } } satisfies StepEvent);
    emit();

    const usage: StepUsage = {
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      calls: 0,
      thinking: [],
      models: new Set(),
    };
    const notes: string[] = [];
    const thoughts: string[] = [];
    const ctx: StepCtx = {
      note: (d) => void notes.push(d),
      think: (t) => void (t.trim() && thoughts.push(t.trim())),
      signal: handle?.signal,
    };

    const finish = (status: ReasoningStep["status"], err?: unknown) => {
      s.status = status;
      s.ms = Date.now() - s.startedAt;
      s.tokens = usage.tokens || undefined;
      s.promptTokens = usage.promptTokens || undefined;
      s.completionTokens = usage.completionTokens || undefined;
      s.models = usage.models.size ? [...usage.models] : undefined;
      const detail = err ? (err instanceof Error ? err.message : String(err)) : notes.join(" · ");
      s.detail = detail ? clipText(detail, 600) : undefined;
      const thinking = [...thoughts, ...usage.thinking].join("\n\n");
      s.thinking = thinking ? clipText(thinking, 6_000) : undefined;
      emit();
    };

    const exec = () => stepUsage.run(usage, () => Promise.resolve(fn(state, ctx)));
    const run = async () => {
      try {
        const out = await exec();
        finish("done");
        return out;
      } catch (err) {
        finish("error", err);
        throw err;
      }
    };

    if (!tracingEnabled()) return run();
    return startActiveObservation(
      `step:${node}`,
      async (span) => {
        try {
          const out = await run();
          span.update({ output: { detail: s.detail, tokens: s.tokens }, metadata: { label: s.label } });
          return out;
        } catch (err) {
          span.update({ level: "ERROR", statusMessage: s.detail });
          throw err;
        }
      },
      { asType: "chain" },
    );
  };
}

/** Mark a branch the graph decided not to take, so the timeline explains why. */
export function skipStep(config: LangGraphRunnableConfig, node: string, label: string, detail: string): void {
  const handle = runHandle(config);
  config.writer?.({
    [STEP_EVENT]: { id: handle?.nextId(node) ?? node, node, label, status: "skipped", detail, startedAt: Date.now(), ms: 0 },
  } satisfies StepEvent);
}

/** Structural view of a compiled LangGraph; flows pass their state type explicitly. */
export interface StreamableGraph {
  stream(input: never, options: never): Promise<AsyncIterable<unknown>>;
}

type StreamFn = (input: unknown, options: Record<string, unknown>) => Promise<AsyncIterable<unknown>>;

export interface RunGraphOptions<I> {
  input: I;
  flow: AiFlow;
  organizationId?: string | null;
  userId?: string | null;
  subject?: { type: string; id: string };
  /** Persist the timeline to ai_runs (default true). */
  persist?: boolean;
  onStep?: (step: ReasoningStep) => void;
  signal?: AbortSignal;
  /** Summarised into the Langfuse trace input. */
  traceInput?: unknown;
}

export interface RunGraphResult<S> {
  state: S;
  steps: ReasoningStep[];
  runId: string | null;
  traceId: string | null;
  tokens: number;
}

async function insertRun(o: RunGraphOptions<unknown>): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_runs")
      .insert({
        organizationId: o.organizationId ?? null,
        flow: o.flow,
        subjectType: o.subject?.type ?? null,
        subjectId: o.subject?.id ?? null,
        createdBy: o.userId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (err) {
    log.warn("ai_runs insert failed (migration 47 applied?)", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Run a compiled LangGraph as one traced, persisted AI flow. */
export async function runGraph<S, I = unknown>(graph: StreamableGraph, o: RunGraphOptions<I>): Promise<RunGraphResult<S>> {
  const runId = o.persist === false ? null : await insertRun(o as RunGraphOptions<unknown>);
  const steps: ReasoningStep[] = [];
  const counts = new Map<string, number>();
  const handle: RunHandle = {
    nextId: (node) => {
      const n = (counts.get(node) ?? 0) + 1;
      counts.set(node, n);
      return n === 1 ? node : `${node}#${n}`;
    },
    signal: o.signal,
  };

  let saving: Promise<unknown> = Promise.resolve();
  const save = (patch: Record<string, unknown>) => {
    if (!runId) return;
    saving = saving.then(async () => {
      const { error } = await supabaseAdmin.from("ai_runs").update(patch).eq("id", runId);
      if (error) log.warn("ai_runs update failed", error.message);
    });
  };
  const tokens = () => steps.reduce((n, s) => n + (s.tokens ?? 0), 0);

  const execute = async (): Promise<{ state: S; traceId: string | null }> => {
    const traceId = tracingEnabled() ? getActiveTraceId() ?? null : null;
    if (traceId) save({ traceId });
    let last: S | undefined;
    const stream = await (graph.stream as unknown as StreamFn).call(graph, o.input, {
      streamMode: ["custom", "values"],
      configurable: { aiRun: handle },
      signal: o.signal,
      recursionLimit: 40,
    });
    for await (const chunk of stream) {
      const [mode, payload] = chunk as [string, unknown];
      if (mode === "values") {
        last = payload as S;
      } else if (mode === "custom" && isStepEvent(payload)) {
        const st = payload[STEP_EVENT];
        const i = steps.findIndex((x) => x.id === st.id);
        if (i >= 0) steps[i] = st;
        else steps.push(st);
        o.onStep?.(st);
        save({ steps, tokens: tokens() });
      }
    }
    if (last === undefined) throw new Error(`${o.flow}: graph produced no state`);
    return { state: last, traceId };
  };

  const traced = () =>
    context.with(ROOT_CONTEXT, () =>
      propagateAttributes(
        {
          traceName: o.flow,
          userId: o.userId ?? undefined,
          sessionId: o.subject ? `${o.subject.type}:${o.subject.id}` : undefined,
          tags: [o.flow],
          metadata: { organizationId: o.organizationId ?? null, runId },
        },
        () =>
          startActiveObservation(
            o.flow,
            async (span) => {
              span.update({ input: o.traceInput });
              try {
                const r = await execute();
                span.update({ output: { steps: steps.map((s) => `${s.label}: ${s.status}`) } });
                return r;
              } catch (err) {
                span.update({ level: "ERROR", statusMessage: err instanceof Error ? err.message : String(err) });
                throw err;
              }
            },
            { asType: "agent" },
          ),
      ),
    );

  try {
    const { state, traceId } = await flowScope.run({ flow: o.flow }, () => (tracingEnabled() ? traced() : execute()));
    save({ status: "done", steps, tokens: tokens(), endedAt: new Date().toISOString() });
    await saving;
    return { state, steps, runId, traceId, tokens: tokens() };
  } catch (err) {
    save({
      status: "error",
      steps,
      tokens: tokens(),
      error: clipText(err instanceof Error ? err.message : String(err), 500),
      endedAt: new Date().toISOString(),
    });
    await saving;
    throw err;
  }
}
