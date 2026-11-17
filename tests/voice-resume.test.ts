import assert from "node:assert/strict";
import test from "node:test";

import { handleVoiceSave, type VoiceSaveOps } from "@/app/api/voice/save/logic";
import { joinTranscriptChunk, dropRepeatedUserLines } from "@/lib/transcript/dedupe";
import { closePartialTurn, isRepeatedAssistantLine, stripToolCallText } from "@/lib/transcript/sanitize";
import { candidateAskedToGoBack, decideQuestionMove, nextOpenQuestion, type MoveState } from "@/lib/voice/question-progress";
import {
  askedBefore,
  buildResumeHints,
  recentRecap,
  resumeBehaviorRule,
  resumeCue,
  shouldResume,
  type ResumeState,
} from "@/lib/voice/resume-prompt";

const QUESTIONS = Array.from({ length: 10 }, (_, i) => ({ text: `Question text ${i + 1}?` }));
QUESTIONS[2] = { text: "How do you improve Flutter app performance?" };
QUESTIONS[3] = { text: "What is your notice period and timeline?" };

const resume = (o: Partial<ResumeState> = {}): ResumeState => ({
  current: 4,
  questions: QUESTIONS,
  asked: [0, 1, 2, 3],
  recent: [
    { role: "assistant", text: "What is your notice period and timeline? signal_question_change{questionIndex:4,userRequested:false" },
    { role: "user", text: "Thirty days, I can join next month." },
  ],
  ...o,
});

// ── Resume prompt ─────────────────────────────────────────────────

test("resume rule: no greeting, right question number, asked list, cleaned recap", () => {
  const rule = resumeBehaviorRule(resume());
  assert.match(rule, /do NOT greet/);
  assert.match(rule, /do NOT introduce yourself/);
  assert.match(rule, /NEVER call any question "the first question"/);
  assert.match(rule, /question 5 of 10: "Question text 5\?"/);
  assert.match(rule, /never ask these again/);
  for (const i of [1, 2]) assert.match(rule, new RegExp(`- ${i}\\. Question text ${i}\\?`));
  assert.match(rule, /- 3\. How do you improve Flutter app performance\?/);
  assert.match(rule, /- 4\. What is your notice period and timeline\?/);
  assert.doesNotMatch(rule, /- 5\./, "current question is not in the asked list");
  assert.match(rule, /Participant: Thirty days/);
  assert.doesNotMatch(rule, /signal_question_change/);
  assert.doesNotMatch(rule, /Here is the first question/);
  assert.match(rule, /Sorry, we got disconnected/);
});

test("resume rule (Chinese) keeps the same rules", () => {
  const rule = resumeBehaviorRule(resume(), true);
  assert.match(rule, /不要打招呼/);
  assert.match(rule, /第5题（共10题）/);
  assert.match(rule, /绝对不要再问/);
});

test("resume cue: replies to a pending answer, otherwise continues the question", () => {
  assert.match(resumeCue(resume({ pendingAnswer: true })), /has not been replied to yet/);
  const cue = resumeCue(resume());
  assert.match(cue, /no greeting, no introduction/);
  assert.match(cue, /question 5 of 10/);
  assert.match(cue, /Do not repeat questions already asked/);
});

test("recap keeps the last lines, shortened", () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? ("user" as const) : ("assistant" as const), text: `line ${i} ${"x".repeat(i === 19 ? 400 : 1)}` }));
  const recap = recentRecap(recent).split("\n");
  assert.equal(recap.length, 8);
  assert.match(recap[0], /^You: line 12/);
  assert.ok(recap[7].length < 300 && recap[7].endsWith("…"));
});

test("when to resume, and what counts as asked", () => {
  assert.equal(shouldResume(0, null), false);
  assert.equal(shouldResume(0, { recent: [] }), false);
  assert.equal(shouldResume(3, null), true);
  assert.equal(shouldResume(0, { recent: [{ role: "assistant", text: "Hello, I'm Sarah" }] }), true);
  assert.deepEqual(askedBefore(3, [5, 3, -1, 99], 10), [0, 1, 2, 5]);
});

test("browser resume hints: none on a fresh start, cleaned on reconnect", () => {
  assert.equal(buildResumeHints(0, [], []), null);
  const hints = buildResumeHints(2, [{ role: "assistant", text: "signal_question_change{questionIndex:2}" }, { role: "user", text: "I use Riverpod." }], [1, 0, 2, 1]);
  assert.deepEqual(hints, { recent: [{ role: "user", text: "I use Riverpod." }], askedQuestionIndexes: [0, 1] });
});

// ── No-repeat guard ───────────────────────────────────────────────

const state = (o: Partial<MoveState> = {}): MoveState => ({
  current: 4,
  total: 10,
  completed: new Set([0, 1, 2, 3]),
  userSpokeThisQuestion: true,
  dwellMs: 60_000,
  minDwellMs: 15_000,
  ...o,
});

test("guard: the model can't go back to a question already asked", () => {
  const d = decideQuestionMove(state(), { target: 0, userRequested: false, candidateAskedBack: false });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.reason, "backward");
  // The model claiming the candidate asked is not enough…
  assert.equal(decideQuestionMove(state(), { target: 2, userRequested: true, candidateAskedBack: false }).ok, false);
  // …the candidate's own words must ask for it.
  assert.deepEqual(decideQuestionMove(state(), { target: 2, userRequested: true, candidateAskedBack: true }), { ok: true, target: 2, end: false });
});

test("guard: same question, invalid index, premature move", () => {
  const same = decideQuestionMove(state(), { target: 4, userRequested: false, candidateAskedBack: false });
  assert.equal(!same.ok && same.reason, "same");
  const bad = decideQuestionMove(state(), { target: -1, userRequested: false, candidateAskedBack: false });
  assert.equal(!bad.ok && bad.reason, "invalid");
  const early = decideQuestionMove(state({ userSpokeThisQuestion: false }), { target: 5, userRequested: false, candidateAskedBack: false });
  assert.equal(!early.ok && early.reason, "premature");
  // Candidate asked to skip: allowed.
  assert.equal(decideQuestionMove(state({ userSpokeThisQuestion: false }), { target: 5, userRequested: true, candidateAskedBack: false }).ok, true);
});

test("guard: moving forward skips questions already asked", () => {
  // Went back to Q2 earlier; Q3–Q5 are done → next is Q6, not Q3.
  const s = state({ current: 1, completed: new Set([0, 2, 3, 4]) });
  assert.deepEqual(decideQuestionMove(s, { target: 2, userRequested: false, candidateAskedBack: false }), { ok: true, target: 5, end: false });
  assert.equal(nextOpenQuestion(7, 10, new Set([7, 8, 9])), 10);
});

test("guard: ending needs an answer on the last question; no early end", () => {
  const last = state({ current: 9, dwellMs: 3_000 });
  assert.deepEqual(decideQuestionMove(last, { target: 10, userRequested: false, candidateAskedBack: false }), { ok: true, target: 10, end: true });
  const early = decideQuestionMove(state({ current: 3, dwellMs: 2_000 }), { target: 10, userRequested: false, candidateAskedBack: false });
  assert.equal(!early.ok && early.reason, "premature");
});

test("candidate 'go back' detection", () => {
  assert.equal(candidateAskedToGoBack("Can we go back to the previous question?"), true);
  assert.equal(candidateAskedToGoBack("could I go back and add something"), true);
  assert.equal(candidateAskedToGoBack("回到上一题"), true);
  assert.equal(candidateAskedToGoBack("I'll get back to you on that"), false);
  assert.equal(candidateAskedToGoBack("I used async and await in Dart"), false);
});

// ── Transcript sanitising and merge handling ──────────────────────

test("tool-call text is removed from AI text", () => {
  assert.equal(stripToolCallText("signal_question_change{questionIndex:10,userRequested:false"), "");
  assert.equal(
    stripToolCallText("Great answer. signal_question_change{questionIndex: 3, userRequested: false} Now, how do you manage state?"),
    "Great answer. Now, how do you manage state?",
  );
  assert.equal(stripToolCallText("print(default_api.signal_question_change(questionIndex=4)) Okay."), "Okay.");
  assert.equal(stripToolCallText("Let's talk about signals in Flutter."), "Let's talk about signals in Flutter.");
});

test("interrupted AI turns end cleanly and are not glued to the next one", () => {
  assert.equal(closePartialTurn("That makes sense, reviewing"), "That makes sense, reviewing…");
  assert.equal(closePartialTurn("Thanks."), "Thanks.");
  assert.equal(closePartialTurn("signal_question_change{questionIndex:2}"), "");
  // If chunks are joined anyway, a new sentence gets a space.
  assert.equal(joinTranscriptChunk("That makes sense, reviewing", "Yes, I'm here!"), "That makes sense, reviewing Yes, I'm here!");
});

test("the same AI question twice in a row is a repeat", () => {
  const q = "How do you handle state management in Flutter?";
  assert.equal(isRepeatedAssistantLine(q, q), true);
  assert.equal(isRepeatedAssistantLine(`Great. ${q}`, q), true);
  assert.equal(isRepeatedAssistantLine(q, "Can you tell me about async programming in Dart?"), false);
  assert.equal(isRepeatedAssistantLine(null, q), false);
  const { kept, dropped } = dropRepeatedUserLines(null, [
    { role: "assistant", content: q },
    { role: "assistant", content: q },
    { role: "user", content: "I use Bloc." },
    { role: "assistant", content: q },
  ]);
  assert.equal(dropped, 1);
  assert.equal(kept.length, 3);
});

test("save API strips tool-call text and skips the repeated AI line", async () => {
  const stored: string[] = [];
  const ops = {
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
    async updateSession() {},
    async generateSummary() {},
    log: { info() {}, error() {} },
    now: () => new Date("2026-11-17T08:00:00Z"),
  } as unknown as VoiceSaveOps;
  const res = await handleVoiceSave(
    {
      sessionId: "s1",
      messages: [
        { role: "assistant", content: "What is your notice period? signal_question_change{questionIndex:4,userRequested:false" },
        { role: "assistant", content: "What is your notice period?" },
        { role: "assistant", content: "signal_question_change{questionIndex:10,userRequested:false}" },
        { role: "user", content: "Thirty days." },
      ],
    },
    ops,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(stored, ["What is your notice period?", "Thirty days."]);
});
