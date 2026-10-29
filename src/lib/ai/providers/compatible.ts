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
    const response = await this.client.chat.completions.create({
      model,
      messages: this.toOpenAIMessages(params.messages),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 2048,
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
  }

  async *streamResponse(params: GenerationParams & { model?: string }): AsyncIterable<string> {
    const model = params.model ?? this.defaultModel;
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
  }
}
