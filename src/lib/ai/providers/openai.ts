import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { type LLMProvider, type GenerationParams, type LLMResponse, type LLMMessage } from "../types";

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "OpenAI";
  models = Array.from(
    new Set(
      [process.env.OPENAI_MODEL, process.env.OPENAI_REPORT_MODEL, "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o3-mini"].filter(
        (m): m is string => !!m
      )
    )
  );
  defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  private toOpenAIMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    const out = messages.map((m) => ({
      role: m.role,
      content: m.content as string & Array<unknown>,
    }));
    // Some OpenAI-compatible backends (e.g. Gemini) reject prompts made only
    // of system messages ("contents is not specified"). Send the last one as
    // a user turn in that case.
    if (out.length > 0 && out.every((m) => m.role === "system")) {
      out[out.length - 1] = { ...out[out.length - 1], role: "user" };
    }
    return out as ChatCompletionMessageParam[];
  }

  async generateResponse(
    params: GenerationParams & { model?: string }
  ): Promise<LLMResponse> {
    const model = params.model ?? this.defaultModel;
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
  }

  async *streamResponse(
    params: GenerationParams & { model?: string }
  ): AsyncIterable<string> {
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
      if (content) {
        yield content;
      }
    }
  }
}
