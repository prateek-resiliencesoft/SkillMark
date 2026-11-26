/**
 * Regression tests replaying Hindi interview 2 (Nov 26, 3:35–3:43 PM IST):
 * relay text spoken / saved as an interviewer line, a complete answer rejected
 * as unanswered and the follow-up asked again, the CTC answer dropped, a
 * reminder right after an answer, an earlier line glued onto the last turn.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { storedLineText } from "@/app/api/voice/save/logic";
import { stripToolCallText } from "@/lib/transcript/sanitize";
import {
  cleanInterviewerTurn,
  isInternalText,
  isStaleRepeatSentence,
  sanitizeInterviewerText,
} from "@/lib/voice/interviewer-text";
import {
  SILENCE_PROMPT_AFTER_ANSWER_MS,
  TOOL_DECISION_MAX_WAIT_MS,
  TOOL_DECISION_QUIET_MS,
  silencePromptBlocked,
  toolDecisionDelayMs,
} from "@/lib/voice/tool-call-timing";
import { cleanCandidateTranscript, looksLikeEcho, stripEchoPrefix } from "@/lib/voice/transcript-filter";
import { TurnGate } from "@/lib/voice/turn-gate";

const REJECTION_LINE =
  "[SYSTEM] The tool call was rejected because your last follow-up question is still unanswered. Wait silently for the participant's answer.";

describe("03:36:22 relay / tool-rejection text never reaches the transcript", () => {
  it("a line that is only relay text becomes empty (shown, saved, history)", () => {
    assert.equal(sanitizeInterviewerText(REJECTION_LINE), "");
    assert.equal(stripToolCallText(REJECTION_LINE), "");
    assert.equal(storedLineText(REJECTION_LINE, "assistant"), "");
    assert.ok(isInternalText(REJECTION_LINE));
  });
  it("real words before the tag are kept, the rest of the line is dropped", () => {
    assert.equal(
      sanitizeInterviewerText(`Achha, samajh gayi. ${REJECTION_LINE}`),
      "Achha, samajh gayi.",
    );
    assert.equal(
      sanitizeInterviewerText("Theek hai. The tool call was rejected. FitPassio ke key features kya the?"),
      "Theek hai. FitPassio ke key features kya the?",
    );
  });
  it("candidate lines are not filtered by interviewer phrases", () => {
    assert.equal(storedLineText("Meri pehli application was rejected, phir maine dobara apply kiya.", "user"),
      "Meri pehli application was rejected, phir maine dobara apply kiya.");
  });
  it("ordinary interviewer lines are untouched", () => {
    const q = "Aapka current CTC kya hai, aur aapki expected CTC kya hai?";
    assert.equal(sanitizeInterviewerText(q), q);
    assert.equal(isInternalText(q), false);
  });
});

describe("03:36:20 a complete answer is not rejected before its transcript arrives", () => {
  it("holds the tool call while the candidate's turn is open or its transcript is missing", () => {
    const base = { waitedMs: 0, candidateTurnOpen: false, speechSinceModel: false, transcriptSinceModel: false, msSinceTranscriptChunk: null };
    assert.equal(toolDecisionDelayMs(base), 0, "nothing said: decide now");
    assert.ok(toolDecisionDelayMs({ ...base, candidateTurnOpen: true }) > 0, "still talking");
    assert.ok(toolDecisionDelayMs({ ...base, speechSinceModel: true }) > 0, "spoke, transcript not in yet");
    assert.equal(
      toolDecisionDelayMs({ ...base, speechSinceModel: true, transcriptSinceModel: true, msSinceTranscriptChunk: 200 }),
      TOOL_DECISION_QUIET_MS - 200,
      "transcript still arriving",
    );
    assert.equal(toolDecisionDelayMs({ ...base, speechSinceModel: true, transcriptSinceModel: true, msSinceTranscriptChunk: 900 }), 0);
    assert.equal(toolDecisionDelayMs({ ...base, candidateTurnOpen: true, waitedMs: TOOL_DECISION_MAX_WAIT_MS }), 0, "never held forever");
  });
  it("after a rejection the model's next turn is not delivered (no read-out, no re-ask)", () => {
    const gate = new TurnGate();
    gate.candidateTurn();
    gate.rejected();
    assert.equal(gate.modelOutput(), false, "post-rejection turn suppressed whole");
    assert.equal(gate.modelTurnEnded(), true);
    gate.candidateTurn(); // the candidate speaks again
    assert.equal(gate.modelOutput(), true);
    assert.equal(gate.isOpen, true);
  });
});

describe("03:40:07 the CTC answer is kept", () => {
  const question = ["Joining timeline aur notice period toh clear ho gaya. Ab mujhe yeh batayein ki aapka current CTC kya hai, agar aap kaam kar rahe hain, aur aapki expected CTC kya hai?"];
  it("an answer reusing the question's words is not echo", () => {
    const r = cleanCandidateTranscript("Mera current CTC 6.5 LPA hai aur expected CTC 12 to 15 LPA hai.", { language: "hi", recentAssistant: question, audioMs: 4000, voicedMs: 2500 });
    assert.equal(r.dropped, null);
    assert.match(r.text, /6\.5 LPA/);
  });
  it("an echoed tail of the question before the answer is stripped, the answer kept", () => {
    const r = cleanCandidateTranscript("aur aapki expected CTC kya hai? Mera current CTC 6.5 LPA hai aur expected 12 se 15.", { language: "hi", recentAssistant: question });
    assert.equal(r.dropped, null);
    assert.equal(r.text, "Mera current CTC 6.5 LPA hai aur expected 12 se 15.");
    assert.equal(stripEchoPrefix("Main Pune relocate kar sakta hoon", question), "Main Pune relocate kar sakta hoon");
  });
  it("only a verbatim copy of the interviewer's words is echo", () => {
    assert.equal(looksLikeEcho("aapka current CTC kya hai, agar aap kaam kar rahe hain", question), true);
    assert.equal(looksLikeEcho("current CTC 6.5 aur expected CTC 12", question), false);
  });
  it("a low mic level never drops a real answer; only a few words over silent audio are dropped", () => {
    assert.equal(cleanCandidateTranscript("Mera current CTC 6.5 LPA hai aur expected 12 to 15 LPA", { language: "hi", audioMs: 4000, voicedMs: 0 }).dropped, null);
    assert.equal(cleanCandidateTranscript("Haan ji", { language: "hi", audioMs: 2000, voicedMs: 0 }).dropped, "silence");
  });
});

describe("03:41:52 no 'Kya aap mujhe sun pa rahe hain?' right after an answer", () => {
  const idle = {
    candidateTurnOpen: false, aiAudioPlaying: false, modelGenerating: false, toolDecisionPending: false,
    replyWatchdogArmed: false, candidateWordsSinceModel: false, msSinceCandidateSpeech: null, interviewEnding: false,
  };
  it("blocked while the candidate just answered, the model is working or a tool call is held", () => {
    assert.equal(silencePromptBlocked({ ...idle, msSinceCandidateSpeech: 9_000 }), true);
    assert.equal(silencePromptBlocked({ ...idle, modelGenerating: true }), true);
    assert.equal(silencePromptBlocked({ ...idle, toolDecisionPending: true }), true);
    assert.equal(silencePromptBlocked({ ...idle, candidateWordsSinceModel: true }), true);
  });
  it("allowed after real silence", () => {
    assert.equal(silencePromptBlocked(idle), false);
    assert.equal(silencePromptBlocked({ ...idle, msSinceCandidateSpeech: SILENCE_PROMPT_AFTER_ANSWER_MS + 1 }), false);
  });
});

describe("03:42:59 an earlier line is not glued onto the last turn", () => {
  const earlier = [
    "Koi issue nahi hai, yeh acchi baat hai. Last question, kya aap apne skills ya experience mein se kuch aur highlight karna chahte hain?",
    "Theek hai, samajh gayi.",
  ];
  it("drops the stale tail, keeps the farewell", () => {
    const turn = "Bahut bahut dhanyavaad Pankaj, aapse baat karke accha laga. Hum aapko jaldi update karenge. issue nahi hai, yeh acchi baat hai. Last question, kya aap apne skills ya experience mein se kuch aur haailaait karna chaahte hain?";
    assert.equal(
      cleanInterviewerTurn(turn, earlier),
      "Bahut bahut dhanyavaad Pankaj, aapse baat karke accha laga. Hum aapko jaldi update karenge.",
    );
  });
  it("never empties a turn and keeps new sentences", () => {
    const one = "Last question, kya aap apne skills ya experience mein se kuch aur highlight karna chahte hain?";
    assert.equal(cleanInterviewerTurn(one, earlier), one, "the first sentence is always kept");
    assert.equal(cleanInterviewerTurn("Theek hai. Aapka notice period kitna hai?", earlier), "Theek hai. Aapka notice period kitna hai?");
    assert.equal(isStaleRepeatSentence("Aapka notice period kitna hai?", earlier), false);
  });
});

describe("relay wiring (source checks)", () => {
  const gem = readFileSync("server/gemini-voice-relay.ts", "utf8");
  const hook = readFileSync("src/hooks/use-voice.ts", "utf8");
  it("a verbal re-ask is corrected with context only: no interrupt, no second spoken turn", () => {
    const start = gem.indexOf("Verbal re-ask of locked topic");
    const block = gem.slice(start, gem.indexOf("looksLikeFarewell", start));
    assert.ok(start > 0);
    assert.doesNotMatch(block, /type: "interrupt"/);
    assert.doesNotMatch(block, /sayText\(/);
    assert.match(block, /addContext\(reaskCorrectionCue/);
  });
  it("context and cues wait while the model is speaking", () => {
    assert.match(gem, /if \(modelGenerating\) \{\s*\/\/[^\n]*\n\s*deferredSends\.push\(\{ kind: "cue"/);
    assert.match(gem, /if \(modelGenerating\) \{\s*deferredSends\.push\(\{ kind: "context"/);
  });
  it("tool calls wait for the transcript and a rejection silences the next turn", () => {
    assert.match(gem, /toolDecisionDelayMs\(/);
    assert.match(gem, /if \(rejected\) silenceAfterRejection\(\)/);
    assert.match(gem, /if \(candidateSpeechSinceModel \|\| userTextSinceModel\) return false;/);
  });
  it("silence reminders use the shared busy check; drops are logged", () => {
    assert.match(gem, /const busy = silencePromptBlocked\(/);
    assert.match(gem, /stage: "asr_dropped"/);
  });
  it("late output transcription after turnComplete is ignored", () => {
    assert.match(gem, /Ignored late interviewer transcript after turn end/);
  });
  it("the browser sanitizes interviewer text and does not re-render on every audio flush", () => {
    assert.match(hook, /sanitizeInterviewerText\(stripToolCallText\(raw\)\)/);
    assert.match(hook, /s\.isSpeaking && !s\.isProcessing \? s :/);
  });
});
