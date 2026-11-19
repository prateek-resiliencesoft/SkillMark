import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

// The fake "hung" providers do no I/O and AbortSignal.timeout() is unref'd, so on
// Node 20 the event loop empties mid-test and the runner cancels it. Real hung
// calls hold a socket open; this ref'd timer stands in for it.
let keepAlive: ReturnType<typeof setInterval>;
before(() => {
  keepAlive = setInterval(() => {}, 1_000);
});
after(() => clearInterval(keepAlive));

import {
  AI_CALL_TIMEOUT_MS,
  budgetSignal,
  describeAiFailure,
  PARSE_CV_BUDGET_MS,
  raceAbort,
  TIMEOUT_MESSAGE,
} from "@/lib/ai/fail-fast";
import {
  AI_AUTH_FAILED,
  AI_QUOTA_EXHAUSTED,
  AI_QUOTA_MESSAGE,
  classifyAiFailure,
} from "@/lib/ai/key-chain";
import { FailoverProvider } from "@/lib/ai/registry";
import { AiRateLimitError, parseResumeText } from "@/lib/ai/resume-parse";
import type { GenerationParams, LLMProvider, LLMResponse } from "@/lib/ai/types";
import { extractCandidateProfile } from "@/lib/documents/cv-profile";

const httpErr = (status: number, message = `${status} status code`) =>
  Object.assign(new Error(message), { status });

type Behaviour = (params: GenerationParams & { model?: string }) => Promise<LLMResponse>;

function fake(id: string, behaviour: Behaviour, models = ["m1"]): LLMProvider & { calls: number } {
  const p = {
    id,
    name: id,
    models,
    defaultModel: models[0],
    calls: 0,
    async generateResponse(params: GenerationParams & { model?: string }) {
      p.calls++;
      return behaviour(params);
    },
    // eslint-disable-next-line require-yield
    async *streamResponse(): AsyncIterable<string> {
      throw new Error("not used");
    },
  };
  return p;
}

const chainOf = (...providers: LLMProvider[]) =>
  new FailoverProvider(providers.map((provider, keyIndex) => ({ provider, model: "m1", source: "env" as const, keyIndex })));

const reject = (status: number): Behaviour => async () => {
  throw httpErr(status);
};

/** Never answers unless aborted — a hung provider. */
const hung: Behaviour = (params) =>
  new Promise((_, rej) => {
    params.signal?.addEventListener("abort", () => rej(params.signal!.reason), { once: true });
  });

const CV = "Jane Doe\njane@example.com\n+1 555 123 4567\nSenior engineer";
const GOOD_JSON = JSON.stringify({ name: "Jane Doe", email: "jane@example.com", phone: "+1 555 123 4567" });

describe("classifyAiFailure", () => {
  it("recognises quota and auth, ignores other errors", () => {
    assert.equal(classifyAiFailure(httpErr(429)), "quota");
    assert.equal(classifyAiFailure(new Error("RESOURCE_EXHAUSTED: quota exceeded")), "quota");
    assert.equal(classifyAiFailure(httpErr(403)), "auth");
    assert.equal(classifyAiFailure(httpErr(401)), "auth");
    assert.equal(classifyAiFailure(new Error("API key not valid. Please pass a valid API key.")), "auth");
    assert.equal(classifyAiFailure(httpErr(400)), null);
    assert.equal(classifyAiFailure(httpErr(503)), null);
    assert.equal(classifyAiFailure(new Error("Unexpected token")), null);
  });
});

describe("key chain exhaustion tagging", () => {
  it("all keys 429 → AI_QUOTA_EXHAUSTED / status 429", async () => {
    const err = await chainOf(fake("a", reject(429)), fake("b", reject(429)))
      .generateResponse({ messages: [] })
      .catch((e) => e);
    assert.equal(err.code, AI_QUOTA_EXHAUSTED);
    assert.equal(err.status, 429);
  });

  it("all keys 403 → AI_AUTH_FAILED", async () => {
    const err = await chainOf(fake("a", reject(403)), fake("b", reject(403)))
      .generateResponse({ messages: [] })
      .catch((e) => e);
    assert.equal(err.code, AI_AUTH_FAILED);
  });

  it("quota + auth mix counts as quota", async () => {
    const err = await chainOf(fake("a", reject(429)), fake("b", reject(403)))
      .generateResponse({ messages: [] })
      .catch((e) => e);
    assert.equal(err.code, AI_QUOTA_EXHAUSTED);
  });

  it("a non quota/auth failure in the chain is NOT tagged (retry may still help)", async () => {
    const err = await chainOf(fake("a", reject(429)), fake("b", reject(400)))
      .generateResponse({ messages: [] })
      .catch((e) => e);
    assert.equal(err.code, undefined);
  });

  it("stops walking keys once the signal is aborted", async () => {
    const a = fake("a", hung);
    const b = fake("b", reject(429));
    const ac = new AbortController();
    const p = chainOf(a, b).generateResponse({ messages: [], signal: ac.signal }).catch((e) => e);
    ac.abort();
    await p;
    assert.equal(b.calls, 0);
  });
});

describe("extractCandidateProfile fail-fast", () => {
  it("every key out of quota: one pass over the chain, no model/variant retries, fast", async () => {
    const keys = [fake("g1", reject(429), ["a", "b", "c", "d"]), fake("g2", reject(429)), fake("g3", reject(429))];
    const provider = chainOf(...keys);
    const t0 = Date.now();
    const err = await extractCandidateProfile(CV, { models: { provider, generatorModel: "a" } }).catch((e) => e);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(classifyAiFailure(err), "quota");
    assert.deepEqual(keys.map((k) => k.calls), [1, 1, 1]);
    const info = describeAiFailure(err);
    assert.equal(info?.status, 429);
    assert.equal(info?.error, AI_QUOTA_MESSAGE);
  });

  it("every key rejected with 403: fails once with a 503 JSON-able error", async () => {
    const keys = [fake("g1", reject(403)), fake("g2", reject(403))];
    const err = await extractCandidateProfile(CV, { models: { provider: chainOf(...keys), generatorModel: "m1" } }).catch((e) => e);
    assert.deepEqual(keys.map((k) => k.calls), [1, 1]);
    const info = describeAiFailure(err);
    assert.equal(info?.status, 503);
    assert.equal(info?.code, "AI_AUTH_FAILED");
  });

  it("forwards signal + maxRetries 0 and still returns a profile when a key works", async () => {
    let seen: GenerationParams | undefined;
    const ok = fake("g", async (params) => {
      seen = params;
      return { content: GOOD_JSON, finishReason: "stop" };
    });
    const { profile } = await extractCandidateProfile(CV, { models: { provider: chainOf(reject429(), ok), generatorModel: "m1" } });
    assert.equal(profile.email, "jane@example.com");
    assert.equal(seen?.maxRetries, 0);
    assert.ok(seen?.signal);
  });
});

function reject429() {
  return fake("quota", reject(429));
}

describe("time budget", () => {
  it("budget constants stay under the 90s proxy timeout", () => {
    assert.ok(PARSE_CV_BUDGET_MS <= 80_000);
    assert.ok(AI_CALL_TIMEOUT_MS < PARSE_CV_BUDGET_MS);
  });

  it("a hung provider is cut off at the budget and reported as a 504 timeout", async () => {
    const provider = chainOf(fake("slow", hung));
    const signal = budgetSignal(150);
    const t0 = Date.now();
    const err = await extractCandidateProfile(CV, { signal, models: { provider, generatorModel: "m1" } }).catch((e) => e);
    const took = Date.now() - t0;
    assert.ok(took >= 100 && took < 1500, `took ${took}ms`);
    const info = describeAiFailure(err, signal);
    assert.equal(info?.status, 504);
    assert.equal(info?.code, "TIMEOUT");
    assert.equal(info?.error, TIMEOUT_MESSAGE);
  });

  it("a slow provider that ignores the signal still can't outlive the budget (raceAbort)", async () => {
    const signal = budgetSignal(100);
    const ignores = new Promise<string>((r) => setTimeout(() => r("late"), 3000)).then((v) => v);
    const t0 = Date.now();
    const err = await raceAbort(ignores, signal).catch((e) => e);
    assert.ok(Date.now() - t0 < 1500);
    assert.equal(describeAiFailure(err, signal)?.status, 504);
  });

  it("budget signal also fires when the client disconnects (parent abort)", () => {
    const parent = new AbortController();
    const s = budgetSignal(60_000, parent.signal);
    assert.equal(s.aborted, false);
    parent.abort();
    assert.equal(s.aborted, true);
  });

  it("raceAbort passes through a normal result", async () => {
    assert.equal(await raceAbort(Promise.resolve(7), budgetSignal(1000)), 7);
  });
});

describe("describeAiFailure", () => {
  it("returns null for unrelated errors so callers keep their own handling", () => {
    assert.equal(describeAiFailure(new Error("boom")), null);
  });
});

describe("parseResumeText fail-fast", () => {
  it("exhausted quota chain: no 2s/5s/10s backoff, clear message", async () => {
    const keys = [fake("g1", reject(429)), fake("g2", reject(429))];
    const t0 = Date.now();
    const err = await parseResumeText(chainOf(...keys), "m1", CV).catch((e) => e);
    assert.ok(Date.now() - t0 < 1000);
    assert.ok(err instanceof AiRateLimitError);
    assert.equal(err.message, AI_QUOTA_MESSAGE);
    assert.deepEqual(keys.map((k) => k.calls), [1, 1]);
  });
});
