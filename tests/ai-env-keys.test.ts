import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

import { envKeys, resolveCredentials } from "@/lib/ai/credentials";
import { isQuotaError, keyChainExhaustedError, splitKeyList } from "@/lib/ai/key-chain";
import { FailoverProvider } from "@/lib/ai/registry";

describe("splitKeyList", () => {
  it("splits, trims and dedupes comma-joined keys", () => {
    assert.deepEqual(splitKeyList(" k1, k2 ,,k1,k3 "), ["k1", "k2", "k3"]);
  });
  it("keeps a single key and handles empty values", () => {
    assert.deepEqual(splitKeyList("only"), ["only"]);
    assert.deepEqual(splitKeyList(""), []);
    assert.deepEqual(splitKeyList(undefined), []);
  });
});

describe("env key vars", () => {
  it("turns GEMINI_API_KEY with six keys into six chain entries", () => {
    const prev = { g: process.env.GEMINI_API_KEY, o: process.env.GOOGLE_API_KEY };
    process.env.GEMINI_API_KEY = "a1,a2, a3,a4,a5 ,a6";
    delete process.env.GOOGLE_API_KEY;
    try {
      assert.deepEqual(envKeys("GEMINI_API_KEY", "GOOGLE_API_KEY"), ["a1", "a2", "a3", "a4", "a5", "a6"]);
      const creds = resolveCredentials({});
      assert.equal(creds.gemini.from, "env");
      assert.deepEqual(creds.gemini.apiKeys, ["a1", "a2", "a3", "a4", "a5", "a6"]);
    } finally {
      if (prev.g === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev.g;
      if (prev.o !== undefined) process.env.GOOGLE_API_KEY = prev.o;
    }
  });
});

describe("keyChainExhaustedError", () => {
  it("reports quota when any key hit it, even if the last failure was a 400", () => {
    const last = Object.assign(new Error("400 status code (no body)"), { status: 400 });
    const err = keyChainExhaustedError("gemini/org#1, gemini/env#1", last, true);
    assert.match(err.message, /quota/i);
    assert.equal(err.status, 429);
  });
  it("keeps the last error when no key was out of quota", () => {
    const last = Object.assign(new Error("403 forbidden"), { status: 403 });
    const err = keyChainExhaustedError("gemini/org#1", last, false);
    assert.match(err.message, /All AI keys failed.*403 forbidden/);
    assert.equal(err.status, 403);
  });
  it("FailoverProvider surfaces quota after a 429 → 403 → 400 chain", async () => {
    const failing = (status: number, message: string) => ({
      provider: {
        id: "gemini",
        name: "Gemini",
        models: ["gemini-x"],
        defaultModel: "gemini-x",
        generateResponse: async () => {
          throw Object.assign(new Error(message), { status });
        },
      },
      model: "gemini-x",
      source: "org",
      keyIndex: 0,
    });
    const chain = new FailoverProvider([
      failing(429, "RESOURCE_EXHAUSTED"),
      failing(403, "permission denied"),
      failing(400, "400 status code (no body)"),
    ] as never);
    await assert.rejects(chain.generateResponse({ messages: [] } as never), (err: Error & { status?: number }) => {
      assert.match(err.message, /quota/i);
      assert.equal(err.status, 429);
      return true;
    });
  });
  it("detects Gemini quota errors", () => {
    assert.equal(isQuotaError({ status: 429 }), true);
    assert.equal(isQuotaError(new Error("RESOURCE_EXHAUSTED: quota")), true);
    assert.equal(isQuotaError(new Error("Unexpected server response: 429")), true);
    assert.equal(isQuotaError(new Error("400 empty body")), false);
  });
});
