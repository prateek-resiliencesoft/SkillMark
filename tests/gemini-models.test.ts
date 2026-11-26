import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GEMINI_MODEL,
  configuredGeminiModel,
  geminiAcceptsTemperature,
  geminiModelChain,
  googleErrorStatus,
  isModelRejection,
  normalizeGeminiModel,
  unwrapGeminiErrorBody,
} from "@/lib/ai/gemini-models";

test("retired Gemini ids map to their documented replacement", () => {
  assert.equal(normalizeGeminiModel("gemini-3.5-flash"), "gemini-3.6-flash");
  assert.equal(normalizeGeminiModel("models/gemini-3.5-flash"), "gemini-3.6-flash");
  assert.equal(normalizeGeminiModel("gemini-2.5-flash"), "gemini-3.5-flash-lite");
  assert.equal(normalizeGeminiModel("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.equal(normalizeGeminiModel(""), DEFAULT_GEMINI_MODEL);
  assert.equal(configuredGeminiModel(undefined), DEFAULT_GEMINI_MODEL);
  assert.equal(configuredGeminiModel("gemini-3.5-flash"), "gemini-3.6-flash");
});

test("fallback chain starts with the requested model and has no duplicates", () => {
  const chain = geminiModelChain("gemini-3.5-flash");
  assert.equal(chain[0], "gemini-3.6-flash");
  assert.equal(new Set(chain).size, chain.length);
  assert.ok(chain.includes("gemini-3.8-flash"));
  assert.equal(geminiModelChain("gemini-3.8-flash")[0], "gemini-3.8-flash");
});

test("temperature only for models that still use it", () => {
  assert.equal(geminiAcceptsTemperature("gemini-3.6-flash"), false);
  assert.equal(geminiAcceptsTemperature("gemini-3.8-flash"), false);
  assert.equal(geminiAcceptsTemperature("gemini-3.5-flash-lite"), true);
  assert.equal(geminiAcceptsTemperature("gemini-2.5-flash"), true);
  assert.equal(geminiAcceptsTemperature("custom-model"), true);
});

test("array-wrapped Gemini error bodies are unwrapped (SDK would say 'no body')", () => {
  const body = '[{"error":{"code":400,"message":"Gemini API free tier is not available in your country.","status":"FAILED_PRECONDITION"}}]';
  const out = unwrapGeminiErrorBody(body);
  assert.ok(out);
  assert.equal(JSON.parse(out!).error.status, "FAILED_PRECONDITION");
  assert.equal(unwrapGeminiErrorBody('{"error":{"message":"x"}}'), null);
  assert.equal(unwrapGeminiErrorBody("not json"), null);
});

test("only model-id rejections trigger the model fallback", () => {
  const mk = (status: number, message: string, gStatus?: string) =>
    Object.assign(new Error(`${status} ${message}`), { status, error: { message, status: gStatus } });
  assert.equal(isModelRejection(mk(404, "models/gemini-9-flash is not found for API version v1beta", "NOT_FOUND")), true);
  assert.equal(isModelRejection(mk(400, "Unsupported model gemini-x", "INVALID_ARGUMENT")), true);
  assert.equal(isModelRejection(mk(400, "status code (no body)")), true);
  assert.equal(isModelRejection(mk(400, "Gemini API free tier is not available in your country.", "FAILED_PRECONDITION")), false);
  assert.equal(isModelRejection(mk(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT")), false);
  assert.equal(isModelRejection(mk(429, "quota")), false);
  assert.equal(googleErrorStatus(mk(400, "x", "FAILED_PRECONDITION")), "FAILED_PRECONDITION");
});

test("Gemini provider surfaces the real 400 reason and falls back on a rejected model", async () => {
  const { CompatibleOpenAIProvider } = await import("@/lib/ai/providers/compatible");
  const seen: { model: string; temperature?: number }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ model: body.model, temperature: body.temperature });
    if (body.model === "gemini-3.6-flash") {
      return new Response('[{"error":{"code":404,"message":"models/gemini-3.6-flash is not found","status":"NOT_FOUND"}}]', {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const p = new CompatibleOpenAIProvider({
      id: "gemini",
      name: "Google Gemini",
      models: [],
      defaultModel: "gemini-3.5-flash",
      apiKey: "test",
      baseURL: "https://gemini.test/v1beta/openai/",
    });
    const res = await p.generateResponse({ messages: [{ role: "user", content: "hi" }], temperature: 0.3, maxRetries: 0 });
    assert.equal(res.content, "ok");
    assert.deepEqual(seen.map((s) => s.model), ["gemini-3.6-flash", "gemini-3.8-flash"]);
    assert.equal(seen[0].temperature, undefined, "no temperature for Gemini 3.6+");

    // Billing/region 400: no model fallback, and the message keeps Google's reason.
    seen.length = 0;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ model: JSON.parse(String(init?.body)).model });
      return new Response(
        '[{"error":{"code":400,"message":"Gemini API free tier is not available in your country. Please enable billing.","status":"FAILED_PRECONDITION"}}]',
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await assert.rejects(
      p.generateResponse({ messages: [{ role: "user", content: "hi" }], maxRetries: 0 }),
      (err: Error & { status?: number }) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /FAILED_PRECONDITION/);
        assert.match(err.message, /free tier is not available/);
        assert.doesNotMatch(err.message, /no body/);
        return true;
      },
    );
    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
