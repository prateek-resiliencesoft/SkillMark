import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createLogger } from "@/lib/logger";
import {
  geminiAcceptsTemperature,
  geminiModelChain,
  googleErrorStatus,
  isModelRejection,
  unwrapGeminiErrorBody,
} from "../gemini-models";
import type { GenerationParams, LLMMessage, LLMProvider, LLMResponse } from "../types";

const log = createLogger("ai/compatible");

/**
 * fetch for the OpenAI SDK: Gemini's compat endpoint returns errors as a JSON
 * array, which the SDK reports as "(no body)". Re-shape it to `{error:{…}}`.
 */
export const unwrappingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  const unwrapped = unwrapGeminiErrorBody(text);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (unwrapped) headers.set("content-type", "application/json");
  return new Response(unwrapped ?? text, { status: res.status, statusText: res.statusText, headers });
};

export type CompatibleProviderOptions = {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  apiKey: string;
  baseURL?: string;
};

/** OpenAI-compatible chat provider (OpenAI, Gemini OpenAI mode, NVIDIA NIM, Ollama, etc.). */
export class CompatibleOpenAIProvider implements LLMProvider {
  id: string;
  name: string;
  models: string[];
  defaultModel: string;
  private client: OpenAI;

  constructor(opts: CompatibleProviderOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.models = opts.models;
    this.defaultModel = opts.defaultModel;
    this.client = new OpenAI({
      apiKey: opts.apiKey || "unused",
      baseURL: opts.baseURL || undefined,
      fetch: unwrappingFetch,
    });
  }

  private get isGemini() {
    return this.id === "gemini";
  }

  /** Gemini: retired ids mapped to their replacement, then the fallback models. Others: just the model. */
  private modelChain(model: string): string[] {
    return this.isGemini ? geminiModelChain(model) : [model];
  }

  private temperatureFor(model: string, requested?: number): { temperature?: number } {
    if (this.isGemini && !geminiAcceptsTemperature(model)) return {};
    return { temperature: requested ?? 0.7 };
  }

  private toOpenAIMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    const out = messages.map((m) => ({
      role: m.role,
      content: m.content as string & Array<unknown>,
    }));
    if (out.length > 0 && out.every((m) => m.role === "system")) {
      out[out.length - 1] = { ...out[out.length - 1], role: "user" };
    }
    return out as ChatCompletionMessageParam[];
  }

  async generateResponse(params: GenerationParams & { model?: string }): Promise<LLMResponse> {
    const chain = this.modelChain(params.model ?? this.defaultModel);
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: this.toOpenAIMessages(params.messages),
          ...this.temperatureFor(model, params.temperature),
          max_tokens: params.maxTokens ?? 2048,
          ...(params.jsonMode && { response_format: { type: "json_object" as const } }),
        }, { signal: params.signal, maxRetries: params.maxRetries });
        if (i > 0) log.warn(`${this.name}: "${chain[0]}" was rejected; served by fallback model "${model}"`);
        const choice = response.choices[0];
        return {
          content: choice.message.content ?? "",
          finishReason: choice.finish_reason ?? "stop",
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (err) {
        lastErr = err;
        if (params.signal?.aborted || i === chain.length - 1 || !isModelRejection(err)) break;
        log.warn(`${this.name} rejected model "${model}" (${describeApiError(err)}) — trying "${chain[i + 1]}"`);
      }
    }
    throw enrichOpenAIError(lastErr, this.name, chain[0]);
  }

  async *streamResponse(params: GenerationParams & { model?: string }): AsyncIterable<string> {
    const chain = this.modelChain(params.model ?? this.defaultModel);
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      let yielded = false;
      try {
        const stream = await this.client.chat.completions.create({
          model,
          messages: this.toOpenAIMessages(params.messages),
          ...this.temperatureFor(model, params.temperature),
          max_tokens: params.maxTokens ?? 2048,
          stream: true,
        });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yielded = true;
            yield content;
          }
        }
        return;
      } catch (err) {
        lastErr = err;
        if (yielded || i === chain.length - 1 || !isModelRejection(err)) break;
        log.warn(`${this.name} rejected model "${model}" (${describeApiError(err)}) — trying "${chain[i + 1]}"`);
      }
    }
    throw enrichOpenAIError(lastErr, this.name, chain[0]);
  }
}

/** "400 FAILED_PRECONDITION: <Google message>" — status + provider reason, never request data. */
export function describeApiError(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  const reason = googleErrorStatus(err);
  const msg = (e?.error?.message || e?.message || String(err)).replace(/\s+/g, " ").trim().slice(0, 300);
  return [e?.status, reason].filter(Boolean).join(" ") + (msg ? `: ${msg}` : "");
}

function enrichOpenAIError(err: unknown, providerName: string, model: string): Error {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const detail = e?.error?.message || e?.message || String(err);
  const status = e?.status;
  const wrap = (message: string, code: number) => {
    const out = new Error(message) as Error & { status?: number };
    out.status = code;
    return out;
  };
  if (status === 410 || /410\s+status code|gone|retired|no longer (available|supported)/i.test(detail)) {
    return wrap(
      `${providerName} model "${model}" is gone (410). Set a current model in Settings → AI or GEMINI_MODEL / OPENAI_MODEL.`,
      410,
    );
  }
  if (status === 404 || /404|no longer available/i.test(detail)) {
    return wrap(`${providerName} model "${model}" unavailable (404). ${detail}`, 404);
  }
  if (status === 429 || /429|quota|rate.?limit/i.test(detail)) {
    return wrap(
      `${providerName} rate/quota limit (429) for "${model}". Wait and retry, or add another key in Settings → AI.`,
      429,
    );
  }
  if (status === 400 || /\b400\b\s*status code/i.test(detail)) {
    const reason = googleErrorStatus(err);
    const hint = /free tier|billing|location is not supported|FAILED_PRECONDITION/i.test(`${reason ?? ""} ${detail}`)
      ? " Billing/region problem on this key's Google project: enable billing in Google AI Studio (or use a key from a supported region)."
      : /API_KEY|api key/i.test(detail)
        ? " The API key itself was refused."
        : /no body/i.test(detail)
          ? " Provider sent no reason."
          : "";
    return wrap(
      `${providerName} rejected request for "${model}" (400${reason ? ` ${reason}` : ""}${/no body/i.test(detail) ? ", empty body" : ""}): ${detail.replace(/\s+/g, " ").slice(0, 300)}.${hint}`,
      400,
    );
  }
  if (err instanceof Error) {
    if (status && !(err as Error & { status?: number }).status) {
      (err as Error & { status?: number }).status = status;
    }
    return err;
  }
  return wrap(detail, status ?? 500);
}
