import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

import {
  applyKeyOrderPatch,
  maskAiProviders,
  mergeAiProvidersPatch,
  normalizeKeyTiers,
} from "@/lib/ai/credentials";

describe("normalizeKeyTiers", () => {
  it("pads missing tiers to free", () => {
    assert.deepEqual(normalizeKeyTiers(undefined, 3), ["free", "free", "free"]);
    assert.deepEqual(normalizeKeyTiers(["paid"], 3), ["paid", "free", "free"]);
  });

  it("rejects invalid entries as free", () => {
    assert.deepEqual(normalizeKeyTiers(["paid", "gold", null], 3), ["paid", "free", "free"]);
  });

  it("trims to keyCount", () => {
    assert.deepEqual(normalizeKeyTiers(["free", "paid", "paid"], 1), ["free"]);
  });

  it("returns empty when keyCount is 0", () => {
    assert.deepEqual(normalizeKeyTiers(["paid"], 0), []);
  });
});

describe("keyTiers persistence", () => {
  it("clears keyTiers when apiKeys cleared", () => {
    const seeded = applyKeyOrderPatch({}, "gemini", [{ value: "g", tier: "paid" }]);
    const cleared = mergeAiProvidersPatch(seeded, { gemini: { apiKeys: [] } });
    const row = (cleared as { gemini?: { keyTiers?: unknown; apiKeys?: unknown[] } }).gemini;
    assert.deepEqual(row?.apiKeys ?? [], []);
    assert.deepEqual(normalizeKeyTiers(row?.keyTiers, row?.apiKeys?.length ?? 0), []);
  });

  it("maskAiProviders returns keyTiers aligned with hints", () => {
    const raw = applyKeyOrderPatch({}, "openai", [
      { value: "secret-a", tier: "paid" },
      { value: "secret-b", tier: "free" },
    ]);
    const masked = maskAiProviders(raw);
    assert.equal(masked.openai.keyCount, 2);
    assert.deepEqual(masked.openai.keyTiers, ["paid", "free"]);
    assert.equal(masked.openai.apiKeyHints.length, 2);
  });
});
