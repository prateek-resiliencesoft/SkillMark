import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanCandidateTranscript,
  collapseRepeats,
  foreignScriptRatio,
  looksLikeEcho,
  transcriptionLanguageHints,
} from "@/lib/voice/transcript-filter";
import {
  earlyAnsweredQuestions,
  isMetaReply,
  isPresenceAck,
  isSubstantiveCandidateAnswer,
  isSufficientShortAnswer,
  metaComplaintKind,
} from "@/lib/voice/answered-ledger";
import {
  HINGLISH_CUE_NOTE,
  interviewLanguageRequirement,
  multiLanguageRequirement,
} from "@/lib/interview-language";
import { silencePromptCue, silencePromptLine, SILENCE_PROMPTS_HI } from "@/lib/voice/relay-keepalive";
import { transcriptionSettings } from "@/lib/ai/prompts/listening";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";

describe("made-up speech-to-text is dropped, real Hinglish is kept", () => {
  it("drops silence / noise phrases", () => {
    for (const t of ["Thank you.", "Thanks for watching!", "Subtitles by the Amara.org community", "धन्यवाद", "[Music]", "♪♪", "..."]) {
      assert.ok(cleanCandidateTranscript(t, { language: "hi" }).dropped, t);
    }
  });
  it("removes an invented phrase stuck to a real answer", () => {
    const r = cleanCandidateTranscript("Mera notice period 30 days hai. Thanks for watching!", { language: "hi" });
    assert.equal(r.dropped, null);
    assert.equal(r.text.replace(/\s+/g, " ").trim(), "Mera notice period 30 days hai.");
  });
  it("never drops a turn for its script; known made-up phrases are still dropped", () => {
    // A real answer transcribed in the wrong script is kept (an odd script beats a lost answer).
    assert.equal(cleanCandidateTranscript("میں نے پروجیکٹ بنایا", { language: "hi" }).dropped, null);
    assert.equal(cleanCandidateTranscript("ご視聴ありがとうございました", { language: "hi" }).dropped, "hallucination");
    // Stray foreign words are removed from a Hinglish answer.
    assert.equal(cleanCandidateTranscript("Main React use karta hoon میں", { language: "hi" }).text, "Main React use karta hoon");
    assert.equal(cleanCandidateTranscript("मैंने React में project बनाया", { language: "hi" }).dropped, null);
    assert.ok(foreignScriptRatio("Main Node.js use karta hoon", "hi") === 0);
    // Chinese interviews keep Chinese
    assert.equal(cleanCandidateTranscript("我做过三个项目", { language: "zh" }).dropped, null);
  });
  it("collapses repeated n-grams", () => {
    assert.equal(collapseRepeats("haan haan haan haan main ready hoon"), "haan main ready hoon");
    assert.equal(collapseRepeats("I am I am I am I am done"), "I am done");
    assert.equal(collapseRepeats("no no"), "no no");
    assert.ok(cleanCandidateTranscript("thank you thank you thank you thank you", { language: "hi" }).dropped);
  });
  it("drops the interviewer's own voice picked up by the mic (echo)", () => {
    const ai = ["Aapka current CTC kya hai aur aapka notice period kitna hai?"];
    assert.equal(looksLikeEcho("aapka current CTC kya hai aur aapka notice period", ai), true);
    assert.equal(cleanCandidateTranscript("aapka current CTC kya hai aur aapka notice period", { language: "hi", recentAssistant: ai }).dropped, "echo");
    assert.equal(cleanCandidateTranscript("Mera current CTC 8.65 LPA hai", { language: "hi", recentAssistant: ai }).dropped, null);
  });
  it("drops text when the turn's audio never reached voice level", () => {
    assert.equal(cleanCandidateTranscript("ASUP relocate", { language: "hi", audioMs: 1500, voicedMs: 0 }).dropped, "silence");
    assert.equal(cleanCandidateTranscript("Main Pune relocate kar sakta hoon", { language: "hi", audioMs: 1500, voicedMs: 768 }).dropped, null);
  });
});

describe("transcription language is set for Hindi", () => {
  it("Gemini gets hi-IN + en-IN hints for Hindi and multi-language", () => {
    assert.deepEqual(transcriptionLanguageHints("hi"), ["hi-IN", "en-IN"]);
    assert.deepEqual(transcriptionLanguageHints("multi"), ["hi-IN", "en-IN"]);
    assert.deepEqual(transcriptionLanguageHints("en"), []);
  });
  it("OpenAI transcription gets language hi and a Hinglish prompt", () => {
    const s = transcriptionSettings("whisper-1", "hi");
    assert.equal(s.language, "hi");
    assert.match(s.prompt, /Hinglish/);
    assert.equal(transcriptionSettings("whisper-1", "en").language, undefined);
  });
});

describe("one fixed Hinglish style", () => {
  const rule = interviewLanguageRequirement("hi");
  it("defines the style once with a firm no-switch rule", () => {
    assert.match(rule, /ONE FIXED STYLE/);
    assert.match(rule, /NEVER switch/);
    assert.match(rule, /never say the same question again in English/i);
    assert.doesNotMatch(rule, /Mixing Hindi and English on purpose/);
  });
  it("multi-language in Hindi uses the same style", () => {
    assert.match(multiLanguageRequirement("hi"), /ONE FIXED STYLE/);
  });
  it("relay cues carry the Hinglish note and silence reminders are Hinglish", () => {
    assert.match(HINGLISH_CUE_NOTE, /Hinglish/);
    assert.match(HINGLISH_CUE_NOTE, /only once/);
    assert.equal(silencePromptLine(1, "hi"), SILENCE_PROMPTS_HI[0]);
    assert.ok(silencePromptCue(2, "hi").includes(SILENCE_PROMPTS_HI[1]));
    assert.ok(!silencePromptCue(2, "hi").includes("I can't hear"));
  });
});

describe("Hindi meta phrases and yes/no", () => {
  it("recognises Hindi meta replies (Roman and Devanagari)", () => {
    for (const t of ["ruko", "ek minute", "phir se boliye", "फिर से बोलिए", "maine jawab nahi diya", "मैंने जवाब नहीं दिया", "aapne skip kiya", "आपने स्किप कर दिया", "samajh nahi aaya"]) {
      assert.equal(isMetaReply(t), true, t);
      assert.equal(isSubstantiveCandidateAnswer(t, "What is your notice period?"), false, t);
    }
    assert.equal(isMetaReply("Main React mein Redux use karta hoon state ke liye"), false);
  });
  it("complaints in Hindi reopen the skipped question", () => {
    assert.deepEqual(metaComplaintKind("aapne skip kar diya"), { complaint: true, skipped: true });
    assert.equal(metaComplaintKind("maine jawab nahi diya").complaint, true);
    assert.equal(metaComplaintKind("ruko").complaint, false);
  });
  it("haan / ji haan / nahi answer yes-no and screening questions", () => {
    assert.equal(isSufficientShortAnswer("Are you willing to relocate?", "ji haan"), true);
    assert.equal(isSufficientShortAnswer("Are you willing to relocate?", "नहीं"), true);
    assert.equal(isPresenceAck("हाँ"), true);
    assert.equal(isSubstantiveCandidateAnswer("haan", "Explain the virtual DOM."), false);
  });
});

describe("answers given early lock later questions (transcript replay)", () => {
  const qs = [
    { text: "Tell me about yourself." },
    { text: "Why are you currently looking for a new opportunity?" },
    { text: "What is your current CTC?" },
    { text: "What are your compensation expectations?" },
    { text: "Are you willing to relocate? A) Yes B) No" },
    { text: "What is your notice period?" },
  ];
  it("expected CTC + relocation said at Q2 lock Q4 and Q5, not Q3 or Q6", () => {
    const said = "Growth ke liye change chahiye. Mera expected CTC 15-16 LPA hai aur main relocate kar sakta hoon";
    assert.deepEqual(earlyAnsweredQuestions(said, qs, 1, () => false), [3, 4]);
  });
  it("current CTC said early locks the current-CTC question", () => {
    assert.deepEqual(earlyAnsweredQuestions("Abhi mera CTC 8.65 LPA hai", qs, 1, () => false), [2]);
  });
  it("never locks questions already done or open-ended ones", () => {
    assert.deepEqual(earlyAnsweredQuestions("expected 15 LPA", qs, 1, (i) => i === 3), []);
    assert.deepEqual(earlyAnsweredQuestions("I built a React dashboard", qs, 0, () => false), []);
  });
});

describe("echo no longer cuts the AI's voice", () => {
  it("barge-in needs louder, longer, more confident speech", () => {
    assert.ok(ENDPOINTING_CONFIG.bargeInMinRms >= 0.02);
    assert.ok(ENDPOINTING_CONFIG.bargeInMinSpeechMs >= 600);
    assert.ok(ENDPOINTING_CONFIG.bargeInSpeechThreshold >= 0.9);
  });
});

describe("relay / client wiring (source checks)", async () => {
  const { readFileSync } = await import("node:fs");
  const gem = readFileSync("server/gemini-voice-relay.ts", "utf8");
  const oai = readFileSync("server/openai-voice-relay.ts", "utf8");
  const hook = readFileSync("src/hooks/use-voice.ts", "utf8");
  it("one spoken reply = one saved line: the Gemini turn ends on turnComplete only", () => {
    assert.match(gem, /if \(sc\.turnComplete\) \{\s*lastTurnCompleteAt = Date\.now\(\);\s*if \(gate\.modelTurnEnded\(\)\)/);
    assert.doesNotMatch(gem, /if \(sc\.generationComplete \|\| sc\.turnComplete\)/);
  });
  it("Gemini setup sends transcription language hints, with a fallback without them", () => {
    assert.match(gem, /languageCodes: opts\.transcriptionLanguages/);
    assert.match(gem, /retrying without them/);
  });
  it("both relays filter transcripts and tell the browser to drop them", () => {
    assert.match(gem, /cleanCandidateTranscript\(raw/);
    assert.match(oai, /cleanCandidateTranscript\(rawText/);
    assert.match(hook, /case "asr_dropped"/);
  });
  it("the interviewer's pending words are saved before the candidate's answer", () => {
    assert.match(hook, /if \(finalText && chatBufferRef\.current\.trim\(\)\) commitAssistantBuffer\(\)/);
  });
  it("a check-in is never stacked on the interviewer's own turn", () => {
    assert.match(gem, /answer_check_in ignored \(AI speaking or no candidate words/);
  });
});
