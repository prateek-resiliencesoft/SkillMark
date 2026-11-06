import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.AUTH_SECRET ||= "x".repeat(40);

import {
  checkVoiceModel,
  isVoiceCapableProvider,
  voiceBlockedReason,
} from "@/lib/ai/capabilities";
import { applyCustomModelsPatch, decryptAiProviders, getStoredRouting } from "@/lib/ai/credentials";

describe("provider voice capability", () => {
  it("only OpenAI, Gemini and Custom can do voice", () => {
    assert.equal(isVoiceCapableProvider("openai"), true);
    assert.equal(isVoiceCapableProvider("gemini"), true);
    assert.equal(isVoiceCapableProvider("custom"), true);
    assert.equal(isVoiceCapableProvider("anthropic"), false);
    assert.equal(isVoiceCapableProvider("nvidia"), false);
  });

  it("explains why Anthropic is blocked and points to Gemini/OpenAI", () => {
    const msg = voiceBlockedReason("anthropic") ?? "";
    assert.match(msg, /no voice models/i);
    assert.match(msg, /Gemini/);
    assert.match(msg, /OpenAI/);
    assert.equal(voiceBlockedReason("openai"), null);
  });
});

describe("checkVoiceModel", () => {
  it("accepts realtime / live / audio families", () => {
    for (const m of ["gpt-4o-realtime-preview", "gpt-realtime", "gemini-2.0-flash-live-001", "gemini-2.5-flash-native-audio", "voxtral-mini"]) {
      assert.equal(checkVoiceModel(m).ok, true, m);
    }
  });

  it("rejects known text models with a specific reason", () => {
    for (const m of ["claude-sonnet-4", "llama3.1:8b", "gpt-4o-mini", "gemini-2.5-flash", "mistral-7b"]) {
      const r = checkVoiceModel(m);
      assert.equal(r.ok, false, m);
    }
  });

  it("rejects unknown and empty ids instead of guessing", () => {
    assert.equal(checkVoiceModel("my-finetune-v3").ok, false);
    assert.equal(checkVoiceModel("").ok, false);
    assert.equal(checkVoiceModel(undefined).ok, false);
  });
});

describe("applyCustomModelsPatch / routing", () => {
  it("refuses to store a text model as the voice model", () => {
    const r = applyCustomModelsPatch({}, { voiceModel: "llama3.1:8b" });
    assert.ok(r.error);
    assert.equal(decryptAiProviders(r.next).custom?.voiceModel ?? null, null);
  });

  it("stores a valid realtime model and the text model", () => {
    const r = applyCustomModelsPatch({}, { voiceModel: "gpt-4o-realtime-preview", textModel: "llama3.1:8b" });
    assert.equal(r.error, undefined);
    const c = decryptAiProviders(r.next).custom;
    assert.equal(c?.voiceModel, "gpt-4o-realtime-preview");
    assert.equal(c?.textModel, "llama3.1:8b");
  });

  it("allows clearing the voice model", () => {
    const r = applyCustomModelsPatch({ custom: { voiceModel: "gpt-realtime" } }, { voiceModel: "" });
    assert.equal(r.error, undefined);
    assert.equal(decryptAiProviders(r.next).custom?.voiceModel ?? null, null);
  });

  it("strips text-only providers from a stored voice priority list", () => {
    const routing = getStoredRouting({ routing: { voice: ["anthropic", "openai", "nvidia", "gemini"] } });
    assert.deepEqual(routing.voice, ["openai", "gemini"]);
  });
});
