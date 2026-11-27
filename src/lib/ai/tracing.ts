/**
 * LLM observability.
 *
 * - Langfuse (self-hosted, OpenTelemetry): every provider attempt becomes a
 *   `generation` observation nested under whatever graph node / flow span is
 *   active. No-ops when LANGFUSE_* keys are unset or no tracer is registered.
 * - Step usage: calls made inside a reasoning step (see graph/runtime.ts) add
 *   their tokens and any `<think>` text to that step for the in-app timeline.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { startObservation } from "@langfuse/tracing";
import { ROOT_CONTEXT, context } from "@opentelemetry/api";
import type { GenerationParams, LLMMessage, LLMResponse } from "./types";

/** Set while a traced flow (graph/runtime.ts runGraph) is running. */
export const flowScope = new AsyncLocalStorage<{ flow: string }>();

export interface StepUsage {
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  thinking: string[];
  models: Set<string>;
}

export const stepUsage = new AsyncLocalStorage<StepUsage>();

export function tracingEnabled(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/** Skip prompt/output capture (metadata, timing and usage are still sent). */
function captureContent(): boolean {
  return process.env.LANGFUSE_CAPTURE_CONTENT !== "false";
}

const THINK_RE = /<think>([\s\S]*?)(?:<\/think>|$)/gi;

/** Reasoning text some models (MiniMax, Kimi, DeepSeek-style) emit inside `<think>` tags. */
export function extractThinking(text: string): string {
  const parts: string[] = [];
  for (const m of text.matchAll(THINK_RE)) if (m[1].trim()) parts.push(m[1].trim());
  return parts.join("\n\n");
}

const MAX_THINKING_CHARS = 6_000;

function noteUsage(
  model: string | undefined,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  content: string,
) {
  const s = stepUsage.getStore();
  if (!s) return;
  s.calls++;
  s.promptTokens += Math.max(0, usage.promptTokens);
  s.completionTokens += Math.max(0, usage.completionTokens);
  s.tokens += Math.max(
    0,
    usage.totalTokens || usage.promptTokens + usage.completionTokens,
  );
  if (model) s.models.add(model);
  const t = extractThinking(content);
  if (t) {
    const used = s.thinking.reduce((n, x) => n + x.length, 0);
    if (used < MAX_THINKING_CHARS) s.thinking.push(t.slice(0, MAX_THINKING_CHARS - used));
  }
}

/** Inline images are replaced so traces stay small. */
function traceMessages(messages: LLMMessage[]): unknown {
  if (!captureContent()) return undefined;
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n"),
  }));
}

interface CallMeta {
  provider: string;
  source: string;
  keyIndex: number;
  model?: string;
  attempt: number;
}

function startGeneration(meta: CallMeta, params: GenerationParams, stream: boolean) {
  if (!tracingEnabled()) return null;
  // Outside a flow the active span is Next's request span, which Langfuse doesn't export:
  // start a fresh trace instead of hanging off a parent that never arrives.
  if (!flowScope.getStore()) return context.with(ROOT_CONTEXT, () => observe(meta, params, stream));
  return observe(meta, params, stream);
}

function observe(meta: CallMeta, params: GenerationParams, stream: boolean) {
  return startObservation(
    `llm:${meta.provider}`,
    {
      model: meta.model,
      input: traceMessages(params.messages),
      modelParameters: {
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
        ...(params.jsonMode ? { jsonMode: "true" } : {}),
        stream: stream ? "true" : "false",
      },
      metadata: { provider: meta.provider, keySource: meta.source, keySlot: meta.keyIndex + 1, attempt: meta.attempt },
    },
    { asType: "generation" },
  );
}

function failGeneration(gen: ReturnType<typeof startGeneration>, err: unknown) {
  if (!gen) return;
  gen.update({ level: "ERROR", statusMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
  gen.end();
}

export async function tracedGenerate(
  meta: CallMeta,
  params: GenerationParams,
  call: () => Promise<LLMResponse>,
): Promise<LLMResponse> {
  const gen = startGeneration(meta, params, false);
  try {
    const res = await call();
    const promptTokens = res.usage?.promptTokens ?? 0;
    const completionTokens = res.usage?.completionTokens ?? 0;
    const totalTokens = res.usage?.totalTokens ?? promptTokens + completionTokens;
    noteUsage(meta.model, { promptTokens, completionTokens, totalTokens }, res.content);
    gen?.update({
      output: captureContent() ? res.content : undefined,
      usageDetails: res.usage
        ? { input: promptTokens, output: completionTokens, total: totalTokens }
        : undefined,
      metadata: { finishReason: res.finishReason },
    });
    gen?.end();
    return res;
  } catch (err) {
    failGeneration(gen, err);
    throw err;
  }
}

/** Rough token estimate for streams, which don't report usage. */
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

export async function* tracedStream(
  meta: CallMeta,
  params: GenerationParams,
  stream: () => AsyncIterable<string>,
): AsyncIterable<string> {
  const gen = startGeneration(meta, params, true);
  let out = "";
  let first: Date | undefined;
  try {
    for await (const t of stream()) {
      if (!first) {
        first = new Date();
        gen?.update({ completionStartTime: first });
      }
      out += t;
      yield t;
    }
    const inChars = params.messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
    const promptTokens = estimateTokens(inChars);
    const completionTokens = estimateTokens(out.length);
    noteUsage(
      meta.model,
      { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      out,
    );
    gen?.update({
      output: captureContent() ? out : undefined,
      usageDetails: { input: promptTokens, output: completionTokens },
      metadata: { usageEstimated: true },
    });
    gen?.end();
  } catch (err) {
    failGeneration(gen, err);
    throw err;
  }
}

/** Browser link to a trace, when the Langfuse UI URL and project id are configured. */
export function langfuseTraceUrl(traceId: string | null | undefined): string | null {
  const base = (process.env.LANGFUSE_PUBLIC_URL || "").replace(/\/$/, "");
  const project = process.env.LANGFUSE_PROJECT_ID;
  if (!traceId || !base || !project) return null;
  return `${base}/project/${project}/traces/${traceId}`;
}
