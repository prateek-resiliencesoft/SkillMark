import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyLedger,
  isLocked,
  isMetaReply,
  isSubstantiveCandidateAnswer,
  metaReplyCue,
  noReaskBehaviorRules,
  recordAnswer,
  reopenQuestion,
  reopenQuestionCue,
} from "@/lib/voice/answered-ledger";
import { decideQuestionMove, findReopenIndex, nextUnaskedAfter } from "@/lib/voice/question-progress";
import { TurnGate } from "@/lib/voice/turn-gate";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";
import { silencePromptCue } from "@/lib/voice/relay-keepalive";

const Q = [
  "Please introduce yourself.",
  "What is the difference between Stateful and Stateless widgets?",
  "What is the difference between Future and Stream?",
  "How do Row, Column, Stack, Expanded and BuildContext work together in a layout?",
  "Which widget should you use for a long scrolling list? A) Column B) ListView C) Stack D) Row",
];

describe("what counts as a candidate answer", () => {
  it("the complaint in the transcript is not an answer", () => {
    for (const t of [
      "I haven't answered that question yet",
      "You skipped my answer, I wasn't done",
      "wait",
      "Can you repeat that?",
      "I didn't hear the question",
      "Let me finish my answer please",
    ]) {
      assert.equal(isMetaReply(t), true, t);
      assert.equal(isSubstantiveCandidateAnswer(t, Q[3]), false, t);
    }
  });
  it("a long real answer that merely contains a complaint word is still an answer", () => {
    const t = "A Row lays children out horizontally and a Column vertically, and I have not used Stack much but it overlaps widgets in layers while Expanded fills the free space in a flex";
    assert.equal(isMetaReply(t), false);
    assert.equal(isSubstantiveCandidateAnswer(t, Q[3]), true);
  });
  it("a cut-off or filler reply is not an answer to a normal question", () => {
    assert.equal(isSubstantiveCandidateAnswer("um yeah so", Q[1]), false);
    assert.equal(isSubstantiveCandidateAnswer("Yes", Q[1]), false);
    assert.equal(isSubstantiveCandidateAnswer("Stateful widgets keep mutable state", Q[1]), true);
  });
  it("interviewer, silence and system cues never count", () => {
    assert.equal(isSubstantiveCandidateAnswer("[SILENCE_PROMPT] Are you there?", Q[1]), false);
    assert.equal(isSubstantiveCandidateAnswer("", Q[1]), false);
  });
});

describe("the model can never skip a question", () => {
  const base = { current: 3, total: 5, completed: new Set([0, 1, 2]), userSpokeThisQuestion: true, dwellMs: 60_000, minDwellMs: 15_000 };
  it("forward move lands on the next unasked question even if the model asks for a later one", () => {
    // Row/Column (3) was reopened and answered; model tries to jump 3 -> 5 (ListView)
    const d = decideQuestionMove({ ...base, current: 2, completed: new Set([0, 1]) }, { target: 4, userRequested: false, candidateAskedBack: false });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.target, 3);
  });
  it("moves on from Stateful straight to ListView are clamped to Row/Column", () => {
    const d = decideQuestionMove({ ...base, current: 1, completed: new Set([0]) }, { target: 4, userRequested: false, candidateAskedBack: false });
    assert.equal(d.ok && d.target, 2);
  });
  it("no move without a real answer", () => {
    const d = decideQuestionMove({ ...base, userSpokeThisQuestion: false }, { target: 4, userRequested: false, candidateAskedBack: false });
    assert.equal(d.ok, false);
  });
  it("no move while the interviewer's last question is still open", () => {
    const d = decideQuestionMove({ ...base, openInterviewerQuestion: true }, { target: 4, userRequested: false, candidateAskedBack: false });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "pending_question");
  });
  it("an explicit candidate skip is still honoured", () => {
    const d = decideQuestionMove({ ...base, userSpokeThisQuestion: false, dwellMs: 1000 }, { target: 4, userRequested: true, candidateAskedBack: false });
    assert.equal(d.ok, true);
  });
});

describe("a re-asked question never marks the following one as covered", () => {
  it("replay: complaint, re-ask, answer, then the NEXT unasked question (not ListView)", () => {
    let ledger = emptyLedger();
    const completed = new Set<number>([0, 1]);
    let current = 2; // Row/Column was entered but never answered
    // Q3 Future/Stream answered, model wrongly tries to leave Q4 without an answer
    ledger = recordAnswer(ledger, 0, Q[0], "I am a Flutter developer with a year of experience building apps");
    ledger = recordAnswer(ledger, 1, Q[1], "Stateful widgets keep mutable state, stateless ones do not");
    // Candidate: "I haven't answered the Row and Column question"
    const complaint = "You skipped the Row and Column question, I haven't answered it";
    assert.equal(isMetaReply(complaint), true);
    const idx = findReopenIndex(current, (i) => isLocked(ledger, i), true);
    assert.equal(idx, 2);
    ledger = reopenQuestion(ledger, idx!);
    completed.delete(idx!);
    assert.equal(isLocked(ledger, 2), false);
    // the complaint itself did NOT answer anything
    assert.equal(isSubstantiveCandidateAnswer(complaint, Q[2]), false);
    // after the real answer, the next unasked question is Q4, not Q5
    ledger = recordAnswer(ledger, 2, Q[2], "A Future gives one value later and a Stream gives many values over time");
    completed.add(2);
    current = nextUnaskedAfter(2, Q.length, completed);
    assert.equal(current, 3);
    assert.equal(isLocked(ledger, 3), false);
    assert.equal(isLocked(ledger, 4), false);
  });
  it("findReopenIndex goes back to an earlier unanswered question on 'you skipped'", () => {
    const answered = new Set([0, 1, 3]);
    assert.equal(findReopenIndex(3, (i) => answered.has(i), true), 2);
    assert.equal(findReopenIndex(2, (i) => answered.has(i)), 2);
    assert.equal(findReopenIndex(1, (i) => answered.has(i)), null);
  });
  it("the cues tell the model to ask only that question", () => {
    assert.match(reopenQuestionCue(2, Q[2], false), /only/i);
    assert.match(metaReplyCue(2, Q[2], false), /do not change questions/i);
  });
});

describe("no back-to-back interviewer turns", () => {
  it("steps 3-4 / 8-9 / 12-13: a second model turn with no candidate speech is suppressed", () => {
    const g = new TurnGate();
    g.cue(); // opening question
    assert.equal(g.modelOutput(), true);
    assert.equal(g.modelTurnEnded(), false);
    // the model starts talking again on its own (tool-response continuation / noise)
    assert.equal(g.modelOutput(), false);
    assert.equal(g.isSuppressing, true);
    assert.equal(g.modelOutput(), false); // the whole turn stays suppressed
    assert.equal(g.modelTurnEnded(), true);
  });
  it("a real candidate turn (even a complaint) lets the interviewer reply", () => {
    const g = new TurnGate();
    g.cue();
    g.modelOutput();
    g.modelTurnEnded();
    g.candidateTurn();
    assert.equal(g.canSpeak(), true);
    assert.equal(g.modelOutput(), true);
    assert.equal(g.modelTurnEnded(), false);
    assert.equal(g.canSpeak(), false);
  });
  it("silence ladder, reconnect and other relay cues are allowed", () => {
    const g = new TurnGate();
    g.cue();
    g.modelOutput();
    g.modelTurnEnded();
    g.cue(); // silence prompt
    assert.equal(g.modelOutput(), true);
    g.modelTurnEnded();
    assert.equal(g.modelOutput(), false);
  });
  it("a rejected tool call cannot be followed by a spoken turn", () => {
    const g = new TurnGate();
    g.cue();
    g.modelOutput();
    g.modelTurnEnded();
    assert.equal(g.canSpeak(), false); // relay rejects the call, nothing allowed
  });
  it("reset forgets stale permissions", () => {
    const g = new TurnGate();
    g.candidateTurn();
    g.cue();
    g.reset();
    assert.equal(g.canSpeak(), false);
  });
});

describe("silence and prompt rules never advance", () => {
  it("silence cue keeps the current question open and calls no function", () => {
    const t = silencePromptCue(1);
    assert.match(t, /\[SILENCE_PROMPT\]/);
    assert.match(t, /do not move on/i);
    assert.match(t, /do not call any function/i);
  });
  it("prompt: one question per turn, go back when skipped, never drop a question", () => {
    const r = noReaskBehaviorRules(false);
    assert.match(r, /exactly one question/i);
    assert.match(r, /skipped/i);
    assert.match(r, /never drop|do not drop|never skip/i);
    assert.match(r, /moving on/i);
  });
});

describe("end-of-turn silence is longer", () => {
  it("is patient enough for a self-introduction with pauses", () => {
    assert.ok(ENDPOINTING_CONFIG.donePauseMs >= 2_200);
    assert.ok(ENDPOINTING_CONFIG.longAnswerDonePauseMs >= 4_000);
    assert.ok(ENDPOINTING_CONFIG.redemptionMs >= 1_200);
    assert.ok(ENDPOINTING_CONFIG.preSpeechPadMs >= 500);
  });
});
