import type { GenerationParams, LLMMessage, LLMProvider, LLMResponse } from "../types";

type AnthropicContent = { type: "text"; text: string };

function splitMessages(messages: LLMMessage[]) {
  const systemParts: string[] = [];
  const chat: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content
            .map((p) => (p.type === "text" ? p.text : ""))
            .filter(Boolean)
            .join("\n");
    if (m.role === "system") systemParts.push(text);
    else chat.push({ role: m.role, content: text });
  }
  if (chat.length === 0 && systemParts.length > 0) {
    chat.push({ role: "user", content: systemParts.pop()! });
  }
  return { system: systemParts.join("\n\n") || undefined, messages: chat };
}

export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  name = "Anthropic";
  models: string[];
  defaultModel: string;
  private apiKey: string;

  constructor(opts?: { apiKey?: string; models?: string[]; defaultModel?: string }) {
    this.apiKey = opts?.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.defaultModel = opts?.defaultModel || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    this.models = Array.from(
      new Set(
        [this.defaultModel, process.env.ANTHROPIC_MODEL, "claude-sonnet-4-20250514", "claude-3-5-haiku-latest"].filter(
          (m): m is string => !!m,
        ),
      ),
    );
  }

  async generateResponse(params: GenerationParams & { model?: string }): Promise<LLMResponse> {
    const { system, messages } = splitMessages(params.messages);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model ?? this.defaultModel,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.7,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic error ${res.status}: ${err}`);
    }
    const data = (await res.json()) as {
      content?: AnthropicContent[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return {
      content,
      finishReason: data.stop_reason ?? "stop",
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens ?? 0,
            completionTokens: data.usage.output_tokens ?? 0,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }

  async *streamResponse(params: GenerationParams & { model?: string }): AsyncIterable<string> {
    const { system, messages } = splitMessages(params.messages);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model ?? this.defaultModel,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.7,
        stream: true,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    if (!res.ok || !res.body) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic stream error ${res.status}: ${err}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
            yield evt.delta.text;
          }
        } catch {
          /* ignore partial JSON */
        }
      }
    }
  }
}
