import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { GenerationParams, LLMMessage, LLMProvider, LLMResponse } from "../types";

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
    });
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
    const model = params.model ?? this.defaultModel;
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: this.toOpenAIMessages(params.messages),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
        ...(params.jsonMode && { response_format: { type: "json_object" as const } }),
      });
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
      throw enrichOpenAIError(err, this.name, model);
    }
  }

  async *streamResponse(params: GenerationParams & { model?: string }): AsyncIterable<string> {
    const model = params.model ?? this.defaultModel;
    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: this.toOpenAIMessages(params.messages),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2048,
        stream: true,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (err) {
      throw enrichOpenAIError(err, this.name, model);
    }
  }
}

function enrichOpenAIError(err: unknown, providerName: string, model: string): Error {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const detail = e?.error?.message || e?.message || String(err);
  const status = e?.status;
  if (status === 410 || /410\s+status code|gone|retired|no longer (available|supported)/i.test(detail)) {
    return new Error(
      `${providerName} model "${model}" is gone (410). Set a current model in Settings → AI or GEMINI_MODEL / OPENAI_MODEL.`,
    );
  }
  if (status === 404 || /404|no longer available/i.test(detail)) {
    return new Error(`${providerName} model "${model}" unavailable (404). ${detail}`);
  }
  if (status === 429 || /429|quota|rate.?limit/i.test(detail)) {
    return new Error(
      `${providerName} rate/quota limit (429) for "${model}". Wait and retry, or add another key in Settings → AI.`,
    );
  }
  return err instanceof Error ? err : new Error(detail);
}
