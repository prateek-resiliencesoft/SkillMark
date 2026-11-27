import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateWorkloadUsd, usdToInr, formatInr } from "@/lib/ai/studio/pricing";
import { rankModelsForTask, suggestionStrip } from "@/lib/ai/studio/suitability";

describe("pricing helpers", () => {
  it("estimates text workload and converts to INR", () => {
    const usd = estimateWorkloadUsd(
      { inputUsdPerMtok: 0.15, outputUsdPerMtok: 0.6 },
      { kind: "text", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    );
    assert.equal(usd, 0.75);
    assert.equal(usdToInr(usd!, 93), 69.75);
    assert.ok(formatInr(69.75).includes("69"));
  });
});

describe("rankModelsForTask", () => {
  it("filters voice-incapable providers and ranks cheap → best", () => {
    const ranked = rankModelsForTask(
      [
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
          qualityTier: 5,
          inputUsdPerMtok: 3,
          outputUsdPerMtok: 15,
          suitableTasks: ["report", "generate"],
        },
        {
          provider: "gemini",
          modelId: "gemini-live-cheap",
          qualityTier: 3,
          perMinuteUsd: 0.03,
          suitableTasks: ["voice"],
        },
        {
          provider: "openai",
          modelId: "gpt-realtime-1.5",
          qualityTier: 5,
          perMinuteUsd: 0.4,
          suitableTasks: ["voice"],
        },
      ],
      "voice",
      { kind: "audio_min", minutes: 15 },
    );
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].modelId, "gemini-live-cheap");
    assert.equal(ranked[0].rankLabel, "cheap");
    const strip = suggestionStrip(ranked);
    assert.ok(strip.some((m) => m.rankLabel === "cheap"));
    assert.ok(strip.some((m) => m.rankLabel === "best"));
  });
});
