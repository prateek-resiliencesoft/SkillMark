import assert from "node:assert/strict";
import test from "node:test";

import { handleVoiceSave, storedLineText, type VoiceSaveOps } from "@/app/api/voice/save/logic";
import { reportLanguageInstruction } from "@/lib/ai/prompts/summary";
import {
  detectLanguageSwitch,
  interviewLanguageLabel,
  interviewLanguageRequirement,
  interviewLanguageSelectOptions,
  involvesHindi,
  isMultiLanguage,
  normalizeCandidateLanguage,
  normalizeInterviewLanguageSetting,
  resolveInterviewLanguage,
  sessionInterviewLanguage,
} from "@/lib/interview-language";
import { buildReportData } from "@/lib/report-data";
import { devanagariToRoman, hasDevanagari } from "@/lib/transcript/transliterate";
import { resumeBehaviorRule, resumeCue, type ResumeState } from "@/lib/voice/resume-prompt";

// ── Transliteration ──────────────────────────────────────────────────

test("devanagariToRoman: common Hindi sentences become readable Hinglish", () => {
  assert.equal(
    devanagariToRoman("मेरा नाम देवाशीष है, मैंने Flutter में 1 साल काम किया है।"),
    "Mera naam devaashish hai, maine Flutter mein 1 saal kaam kiya hai.",
  );
  assert.equal(devanagariToRoman("आप कैसे हैं? मैं ठीक हूँ।"), "Aap kaise hain? Main theek hun.");
  assert.equal(devanagariToRoman("हिंदी में बात करते हैं"), "Hindi mein baat karte hain");
  assert.equal(devanagariToRoman("अच्छा"), "Accha");
  assert.equal(devanagariToRoman("नौकरी"), "Naukri");
});

test("devanagariToRoman: leaves Roman text untouched and never outputs Devanagari", () => {
  const roman = "I used React and Node. matlab, backend bhi kiya.";
  assert.equal(devanagariToRoman(roman), roman);
  for (const s of ["मैंने 2024 में स्टेट मैनेजमेंट सीखा", "क्या आप ज़िंदगी समझना चाहते हैं?", "फ़ोन", "ठीक है।"]) {
    const out = devanagariToRoman(s);
    assert.equal(hasDevanagari(out), false, `${s} -> ${out}`);
    assert.ok(out.trim().length > 0);
  }
});

test("storedLineText: transcript lines are saved in Roman script", () => {
  assert.equal(storedLineText("मैं ठीक हूँ"), "Main theek hun");
  assert.equal(storedLineText("Thirty days."), "Thirty days.");
});

// ── Language setting helpers ─────────────────────────────────────────

test("multi-language setting and candidate language", () => {
  assert.equal(isMultiLanguage("multi"), true);
  assert.equal(isMultiLanguage("hi"), false);
  assert.equal(resolveInterviewLanguage("multi"), "en");
  assert.equal(normalizeInterviewLanguageSetting("multi"), "multi");
  assert.equal(normalizeInterviewLanguageSetting("Hindi"), "hi");
  assert.equal(normalizeInterviewLanguageSetting(null), "en");
  assert.equal(normalizeCandidateLanguage("hi-IN"), "hi");
  assert.equal(normalizeCandidateLanguage("English"), "en");
  assert.equal(normalizeCandidateLanguage("fr"), null);
  assert.equal(sessionInterviewLanguage("multi", "hi"), "hi");
  assert.equal(sessionInterviewLanguage("multi", null), "en");
  assert.equal(sessionInterviewLanguage("hi", "en"), "hi");
  assert.equal(involvesHindi("multi"), true);
  assert.equal(involvesHindi("hi"), true);
  assert.equal(involvesHindi("en"), false);
});

test("language labels and select options keep legacy values", () => {
  assert.equal(interviewLanguageLabel("en"), "English");
  assert.equal(interviewLanguageLabel("hi"), "Hindi");
  assert.match(interviewLanguageLabel("multi", "hi"), /Multi-language \(Hindi \+ English\).*Hindi/);
  assert.deepEqual(interviewLanguageSelectOptions("en").map((o) => o.value), ["en", "hi", "multi"]);
  assert.deepEqual(interviewLanguageSelectOptions("zh").map((o) => o.value), ["en", "hi", "multi", "zh"]);
});

test("detectLanguageSwitch: explicit requests only", () => {
  assert.equal(detectLanguageSwitch("Hindi mein baat karte hain"), "hi");
  assert.equal(detectLanguageSwitch("हिंदी में बात करें"), "hi");
  assert.equal(detectLanguageSwitch("let's continue in hindi"), "hi");
  assert.equal(detectLanguageSwitch("can we speak English please"), "en");
  assert.equal(detectLanguageSwitch("Kya hum English mein baat kar sakte hain?"), "en");
  assert.equal(detectLanguageSwitch("I studied Hindi in school"), null);
  assert.equal(detectLanguageSwitch("English is my second language"), null);
  assert.equal(detectLanguageSwitch(""), null);
});

test("prompt language rules", () => {
  assert.match(interviewLanguageRequirement("hi"), /HINGLISH/);
  assert.match(interviewLanguageRequirement("hi"), /question list may be written in English/);
  const multi = interviewLanguageRequirement("multi");
  assert.match(multi, /Hindi and English/);
  assert.match(multi, /switch at once/);
  assert.doesNotMatch(multi, /Do not switch to any other language/);
  assert.match(interviewLanguageRequirement("en"), /ENGLISH/i);
});

// ── Reports ──────────────────────────────────────────────────────────

test("report: Hindi / multi interviews are scored fairly and written in English", () => {
  for (const lang of ["hi", "multi"]) {
    const rule = reportLanguageInstruction(lang);
    assert.match(rule, /Hinglish/);
    assert.match(rule, /Do NOT lower any score/);
    assert.match(rule, /ENTIRE report in English/);
  }
  assert.equal(reportLanguageInstruction("en"), "");
  assert.equal(reportLanguageInstruction(null), "");
});

test("report data shows the interview language", () => {
  assert.equal(buildReportData({ interviewLanguage: "multi", language: "hi", messages: [] }).language, "Multi-language (Hindi + English), Hindi chosen");
  assert.equal(buildReportData({ interviewLanguage: "hi", messages: [] }).language, "Hindi");
  assert.equal(buildReportData({ messages: [] }).language, null);
});

// ── Resume keeps the language ────────────────────────────────────────

test("resume prompt and cue keep the candidate's language", () => {
  const s: ResumeState = { current: 1, questions: [{ text: "Q1" }, { text: "Q2" }], asked: [0], recent: [], language: "Hindi (Hinglish)" };
  assert.match(resumeBehaviorRule(s), /Keep speaking Hindi \(Hinglish\)/);
  assert.match(resumeCue(s), /Keep speaking Hindi \(Hinglish\)/);
  assert.doesNotMatch(resumeCue({ ...s, language: undefined }), /Keep speaking/);
});

// ── Save API ─────────────────────────────────────────────────────────

function fakeOps(stored: string[], updates: Array<Record<string, unknown>>) {
  return {
    async insertMessages(_id: string, msgs: Array<{ content: string }>) {
      for (const m of msgs) stored.push(m.content);
    },
    async loadSessionForCompletion() {
      return null;
    },
    async loadFirstMessageTimestamp() {
      return null;
    },
    async loadSessionForProgress() {
      return { interview: { questions: [] } };
    },
    async updateSession(_id: string, patch: Record<string, unknown>) {
      updates.push(patch);
    },
    async generateSummary() {},
    log: { info() {}, error() {} },
    now: () => new Date("2026-11-17T08:00:00Z"),
  } as unknown as VoiceSaveOps;
}

test("save API stores Devanagari lines as Hinglish", async () => {
  const stored: string[] = [];
  const res = await handleVoiceSave(
    { sessionId: "s1", messages: [{ role: "user", content: "मैंने Flutter में काम किया है" }, { role: "assistant", content: "अच्छा, बताइए।" }] },
    fakeOps(stored, []),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(stored, ["Maine Flutter mein kaam kiya hai", "Accha, bataaie."]);
  for (const line of stored) assert.equal(hasDevanagari(line), false);
});

test("save API stores the candidate's language choice on the session", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const res = await handleVoiceSave({ sessionId: "s1", language: "hi" }, fakeOps([], updates));
  assert.equal(res.status, 200);
  assert.deepEqual(updates, [{ language: "hi" }]);

  const ignored: Array<Record<string, unknown>> = [];
  await handleVoiceSave({ sessionId: "s1", language: "klingon" }, fakeOps([], ignored));
  assert.equal(ignored.some((u) => "language" in u), false);
});
