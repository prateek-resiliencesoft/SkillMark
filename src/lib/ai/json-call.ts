import type { AiTaskKind } from "./credentials";
import { extractJson } from "./extract-json";
import { resolveProvider } from "./registry";
import type { LLMMessage } from "./types";

export interface JsonCallResult<T> {
  data: T;
  tokens: number;
  /** Raw model output (may include `<think>` text). */
  raw: string;
}

/** One JSON-mode LLM call through the org's provider chain (failover built in). */
export async function callJson<T = Record<string, unknown>>(opts: {
  organizationId?: string | null;
  task: AiTaskKind;
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<JsonCallResult<T>> {
  const provider = await resolveProvider({ organizationId: opts.organizationId, task: opts.task });
  const res = await provider.generateResponse({
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    maxTokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.4,
    jsonMode: true,
    signal: opts.signal,
  });
  return { data: extractJson<T>(res.content), tokens: res.usage?.totalTokens ?? 0, raw: res.content };
}
