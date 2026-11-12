import assert from "node:assert/strict";
import test from "node:test";

import {
  getInterviewerPersona,
  isDefaultInterviewerName,
  normalizeInterviewerGender,
  resolveGeminiVoice,
  resolveInterviewerName,
  resolveOpenAiVoice,
} from "@/lib/interviewer-persona";

test("defaults missing or unknown gender to Female", () => {
  assert.equal(normalizeInterviewerGender(undefined), "FEMALE");
  assert.equal(normalizeInterviewerGender("female"), "FEMALE");
  assert.equal(normalizeInterviewerGender("MALE"), "MALE");
});

test("maps leftover product or opposite-gender default names to the persona name", () => {
  assert.equal(resolveInterviewerName("Alex", "FEMALE"), "Sarah");
  assert.equal(resolveInterviewerName("Sarah", "MALE"), "Alex");
  assert.equal(resolveInterviewerName("ResilienceSoft Interview", "FEMALE"), "Sarah");
  assert.equal(resolveInterviewerName("Aural", "MALE"), "Alex");
  assert.equal(resolveInterviewerName("Priya", "FEMALE"), "Priya");
  assert.equal(isDefaultInterviewerName("alex"), true);
});

test("persona voices are gender-consistent and env does not override Male", () => {
  assert.equal(getInterviewerPersona("FEMALE").geminiVoice, "Kore");
  assert.equal(getInterviewerPersona("MALE").geminiVoice, "Charon");
  const prev = process.env.GEMINI_LIVE_VOICE;
  process.env.GEMINI_LIVE_VOICE = "Sulafat";
  assert.equal(resolveGeminiVoice("FEMALE"), "Sulafat");
  assert.equal(resolveGeminiVoice("MALE"), "Charon");
  if (prev === undefined) delete process.env.GEMINI_LIVE_VOICE;
  else process.env.GEMINI_LIVE_VOICE = prev;

  const prevAzure = process.env.AZURE_OPENAI_VOICE;
  process.env.AZURE_OPENAI_VOICE = "sage";
  assert.equal(resolveOpenAiVoice("FEMALE"), "sage");
  assert.equal(resolveOpenAiVoice("MALE"), "echo");
  if (prevAzure === undefined) delete process.env.AZURE_OPENAI_VOICE;
  else process.env.AZURE_OPENAI_VOICE = prevAzure;
});
