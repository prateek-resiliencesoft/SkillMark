import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

import { applyKeyOrderPatch, applyKeySlotsPatch, decryptAiProviders } from "@/lib/ai/credentials";

function keysOf(raw: unknown) {
  return decryptAiProviders(raw).openai?.apiKeys ?? [];
}

describe("applyKeyOrderPatch", () => {
  const base = applyKeySlotsPatch({}, "openai", ["k-one", "k-two", "k-three"]);

  it("reorders saved keys without needing their plaintext", () => {
    const next = applyKeyOrderPatch(base, "openai", [{ keep: 2 }, { keep: 0 }, { keep: 1 }]);
    assert.deepEqual(keysOf(next), ["k-three", "k-one", "k-two"]);
  });

  it("drops saved keys that were removed and keeps primary in sync", () => {
    const next = applyKeyOrderPatch(base, "openai", [{ keep: 1 }]);
    assert.deepEqual(keysOf(next), ["k-two"]);
  });

  it("mixes new keys with moved saved keys", () => {
    const next = applyKeyOrderPatch(base, "openai", [{ keep: null, value: "k-new" }, { keep: 0 }]);
    assert.deepEqual(keysOf(next), ["k-new", "k-one"]);
  });

  it("never duplicates a saved key referenced twice", () => {
    const next = applyKeyOrderPatch(base, "openai", [{ keep: 0 }, { keep: 0 }]);
    assert.deepEqual(keysOf(next), ["k-one"]);
  });

  it("ignores out-of-range keep and blank new slots", () => {
    const next = applyKeyOrderPatch(base, "openai", [{ keep: 9 }, { value: "  " }, { keep: 2 }]);
    assert.deepEqual(keysOf(next), ["k-three"]);
  });
});
