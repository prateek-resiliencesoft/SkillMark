import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

import {
  getStoredTaskModels,
  routingFromTaskModels,
  routingForTask,
  sanitizeTaskModels,
  storedTaskModel,
} from "@/lib/ai/credentials";

describe("sanitizeTaskModels", () => {
  it("keeps valid hops and drops bad providers / empty models", () => {
    const out = sanitizeTaskModels({
      generate: [
        { provider: "openai", model: " gpt-4o-mini " },
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "nope" as "openai", model: "x" },
        { provider: "gemini", model: "" },
        { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      ],
      voice: [
        { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        { provider: "gemini", model: "gemini-3.1-flash-live-preview" },
      ],
      round2_transcript: [
        { provider: "gemini", model: "whisper" },
        { provider: "groq", model: "whisper-large-v3-turbo" },
      ],
    });
    assert.deepEqual(out.generate, [
      { provider: "openai", model: "gpt-4o-mini" },
      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    ]);
    assert.deepEqual(out.voice, [{ provider: "gemini", model: "gemini-3.1-flash-live-preview" }]);
    assert.deepEqual(out.round2_transcript, [{ provider: "groq", model: "whisper-large-v3-turbo" }]);
  });
});

describe("routingFromTaskModels / routingForTask", () => {
  it("derives provider order from hops", () => {
    const hops = sanitizeTaskModels({
      report: [
        { provider: "gemini", model: "gemini-3.6-flash" },
        { provider: "openai", model: "gpt-4o" },
        { provider: "gemini", model: "gemini-3.8-flash" },
      ],
    });
    assert.deepEqual(routingFromTaskModels(hops).report, ["gemini", "openai"]);
    assert.deepEqual(routingForTask({}, "report", hops), ["gemini", "openai"]);
  });

  it("falls back to stored routing then defaults", () => {
    assert.deepEqual(routingForTask({ report: ["anthropic"] }, "report"), ["anthropic"]);
    assert.ok(routingForTask({}, "report").includes("openai"));
  });
});

describe("storedTaskModel / getStoredTaskModels", () => {
  it("reads first hop model for provider", () => {
    const raw = {
      taskModels: {
        resume: [{ provider: "gemini", model: "gemini-3.6-flash" }],
      },
    };
    const tm = getStoredTaskModels(raw);
    assert.equal(storedTaskModel(tm, "resume", "gemini"), "gemini-3.6-flash");
    assert.equal(storedTaskModel(tm, "resume", "openai"), null);
  });
});
