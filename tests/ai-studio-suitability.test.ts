import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estimateUsdFromIoTokens,
  estimateWorkloadUsd,
  usdToInr,
  formatInr,
} from "@/lib/ai/studio/pricing";
import { estimateUsdForTokens } from "@/lib/ai/studio/usage-aggregate";
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

  it("prices OpenAI gpt-4o with separate input/output tokens", () => {
    // Official list: $2.50 / $10.00 per 1M
    const usd = estimateUsdFromIoTokens(2_000_000, 500_000, 2.5, 10);
    assert.equal(usd, 2_000_000 / 1_000_000 * 2.5 + 500_000 / 1_000_000 * 10);
    assert.equal(usd, 10);
  });

  it("falls back to 70/30 when only total tokens known", () => {
    const withIo = estimateUsdForTokens(1000, 0.15, 0.6, 700, 300);
    const guessed = estimateUsdForTokens(1000, 0.15, 0.6);
    assert.equal(withIo, guessed);
  });
});

describe("paid-key-only usage cost", () => {
  it("charges only paid tokens; free-tier tokens are ₹0", async () => {
    const { aggregateAiUsage } = await import("@/lib/ai/studio/usage-aggregate");
    const catalog = [
      {
        provider: "openai" as const,
        modelId: "gpt-4o-mini",
        qualityTier: 3,
        inputUsdPerMtok: 0.15,
        outputUsdPerMtok: 0.6,
      },
    ];
    const range = { start: new Date("2026-11-01"), end: new Date("2026-11-30") };
    const out = aggregateAiUsage(
      [
        {
          id: "1",
          flow: "round1-summary",
          status: "done",
          tokens: 2000,
          startedAt: "2026-11-15T10:00:00.000Z",
          endedAt: "2026-11-15T10:00:01.000Z",
          error: null,
          subjectType: null,
          subjectId: null,
          steps: [
            {
              id: "a",
              node: "a",
              label: "a",
              status: "done",
              startedAt: 0,
              tokens: 2000,
              promptTokens: 1000,
              completionTokens: 1000,
              paidPromptTokens: 500,
              paidCompletionTokens: 500,
              freePromptTokens: 500,
              freeCompletionTokens: 500,
              models: ["gpt-4o-mini"],
            },
          ],
        },
      ],
      catalog,
      100,
      range,
    );
    // Paid 500 in + 500 out at 0.15 / 0.6 per MTok → USD = 0.000375
    assert.ok(out.totals.estimateUsd != null);
    assert.ok(Math.abs(out.totals.estimateUsd! - 0.000375) < 1e-9);
    assert.equal(out.totals.paidTokens, 1000);
    assert.equal(out.totals.freeTokens, 1000);
    assert.equal(out.byModel[0]?.estimateInrLabel, "₹0.04");
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
