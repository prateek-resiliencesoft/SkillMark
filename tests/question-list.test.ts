import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enforceExactPremadeQuestions, finalizeGeneratedQuestions } from "@/lib/question-conditions";
import { collectExcludedScoreTexts, isQuestionTextExcluded } from "@/lib/premade-sections";
import {
  generalQuestionRank,
  isIntroQuestion,
  orderGeneralFirst,
  sortGeneralQuestions,
  standardIntroText,
  STANDARD_INTRO_EN,
  STANDARD_INTRO_HI,
  ensureIntroQuestion,
} from "@/lib/question-order";
import { mergeQuestionEvaluations } from "@/lib/question-report";
import { buildReportData } from "@/lib/report-data";

type Q = {
  text: string;
  validationRules?: { excludeFromScore?: boolean };
  description?: string;
  order?: number;
};
const t = (text: string): Q => ({ text });

const INTRO = "Please tell me about yourself and introduce yourself.";
const CURRENT_CTC = "What is your current CTC?";
const EXPECTED_CTC = "What is your expected CTC?";
const NOTICE = "What is your notice period?";
const LOCATION = "Where are you currently located? Please share your city and address.";
const RELOCATE = "Are you willing to relocate to our office city?";
const BOND = "Are you comfortable with a 1 year bond or commitment?";
const OTHER = "Do you have any offers in hand?";

describe("canonical order of general questions", () => {
  it("ranks the common HR questions", () => {
    assert.equal(generalQuestionRank(INTRO), 0);
    assert.equal(generalQuestionRank("What is your name?"), 0);
    assert.equal(generalQuestionRank(CURRENT_CTC), 1);
    assert.equal(generalQuestionRank(EXPECTED_CTC), 2);
    assert.equal(generalQuestionRank(NOTICE), 3);
    assert.equal(generalQuestionRank(LOCATION), 4);
    assert.equal(generalQuestionRank(RELOCATE), 5);
    assert.equal(generalQuestionRank(BOND), 6);
    assert.equal(generalQuestionRank(OTHER), 7);
    assert.equal(generalQuestionRank("Explain how a hash map works."), 7);
  });

  it("intro, current CTC, expected CTC, notice, location, relocation, bond, other — whatever the input order", () => {
    const shuffled = [BOND, OTHER, LOCATION, EXPECTED_CTC, RELOCATE, NOTICE, INTRO, CURRENT_CTC].map(t);
    assert.deepEqual(sortGeneralQuestions(shuffled).map((q) => q.text), [INTRO, CURRENT_CTC, EXPECTED_CTC, NOTICE, LOCATION, RELOCATE, BOND, OTHER]);
  });

  it("is stable for questions in the same slot", () => {
    const a = t("Do you have a pending offer?");
    const b = t("Do you prefer remote work?");
    assert.deepEqual(sortGeneralQuestions([b, a]), [b, a]);
  });

  it("general block first, AI questions after; an AI-written intro is moved to the very top", () => {
    const out = orderGeneralFirst([CURRENT_CTC, BOND].map(t), [t("Explain closures."), t("Tell me about yourself"), t("Design a cache.")]);
    assert.deepEqual(out.map((q) => q.text), ["Tell me about yourself", CURRENT_CTC, BOND, "Explain closures.", "Design a cache."]);
  });

  it("applies when premade questions are auto-included with generated ones, and renumbers", () => {
    const premade = [BOND, LOCATION, EXPECTED_CTC, INTRO, CURRENT_CTC].map((x) => ({ text: x, sectionName: "HR" }));
    const generated = [t("Explain the event loop."), t("How do you index a table?")].map((q, i) => ({ ...q, order: i }));
    const out = enforceExactPremadeQuestions(generated, premade);
    assert.deepEqual(out.map((q) => q.text), [INTRO, CURRENT_CTC, EXPECTED_CTC, LOCATION, BOND, "Explain the event loop.", "How do you index a table?"]);
    assert.deepEqual(out.map((q) => q.order), [0, 1, 2, 3, 4, 5, 6]);
    // The intro is always the first question.
    assert.equal(out[0].text, INTRO);
  });

  it("does nothing without premade questions (a manual order is left alone)", () => {
    const qs = [t(BOND), t(INTRO)];
    assert.deepEqual(enforceExactPremadeQuestions(qs, []), qs);
  });
});

describe("question-by-question list includes every question asked", () => {
  const planned = [
    { text: INTRO, order: 0, validationRules: { excludeFromScore: true } },
    { text: CURRENT_CTC, order: 1, validationRules: { excludeFromScore: true } },
    { text: LOCATION, order: 2, validationRules: { excludeFromScore: true } },
    { text: "Explain the event loop in Node.js.", order: 3 },
    { text: "How would you index a large table?", order: 4 },
  ];
  const messages = [
    { role: "assistant", content: INTRO },
    { role: "user", content: "I am Asha, a backend developer." },
    { role: "assistant", content: CURRENT_CTC },
    { role: "user", content: "Twelve lakhs." },
    { role: "assistant", content: LOCATION },
    { role: "user", content: "Pune, Kothrud." },
    { role: "assistant", content: "Explain the event loop in Node.js." },
    { role: "user", content: "It is a loop that handles callbacks." },
    { role: "assistant", content: "How would you index a large table?" },
    { role: "user", content: "Add an index." },
  ];
  // The AI summary only graded the two technical questions (the bug).
  const aiOnlyTechnical = [
    { question: "Explain the event loop in Node.js.", score: 3, evaluation: "Thin." },
    { question: "How would you index a large table?", score: 2, evaluation: "Weak." },
  ];

  it("adds the missing HR / general questions as Not scored, in interview order", () => {
    const out = mergeQuestionEvaluations({ planned, evaluations: aiOnlyTechnical, excludedTexts: [], messages });
    assert.deepEqual(out.map((e) => e.question), planned.map((q) => q.text));
    assert.deepEqual(out.map((e) => e.score), [null, null, null, 3, 2]);
    assert.deepEqual(out.map((e) => !!e.excludeFromScore), [true, true, true, false, false]);
  });

  it("never gives marks to a general question even if the AI scored it", () => {
    const out = mergeQuestionEvaluations({
      planned,
      evaluations: [{ question: CURRENT_CTC, score: 9, evaluation: "ok" }, ...aiOnlyTechnical],
      excludedTexts: [],
      messages,
    });
    const ctc = out.find((e) => e.question === CURRENT_CTC);
    assert.equal(ctc?.score, null);
    assert.equal(ctc?.excludeFromScore, true);
    assert.equal(out.length, 5);
  });

  it("treats question-bank texts as general even without the stamped flag", () => {
    const plain = planned.map(({ text, order }) => ({ text, order }));
    const out = mergeQuestionEvaluations({ planned: plain, evaluations: aiOnlyTechnical, excludedTexts: [INTRO, CURRENT_CTC, LOCATION], messages });
    assert.deepEqual(out.map((e) => !!e.excludeFromScore), [true, true, true, false, false]);
  });

  it("keeps a reworded AI evaluation on its question instead of duplicating it", () => {
    const out = mergeQuestionEvaluations({
      planned,
      evaluations: [{ question: "Explain the event loop in Node.js", score: 4, evaluation: "x" }, aiOnlyTechnical[1]],
      excludedTexts: [],
      messages,
    });
    assert.equal(out.length, 5);
    assert.equal(out[3].score, 4);
  });

  it("leaves out questions that were never reached, keeps ones skipped in the middle, appends unmatched AI follow-ups", () => {
    const early = messages.slice(0, 4); // interview ended after the CTC answer
    const out = mergeQuestionEvaluations({ planned, evaluations: [], excludedTexts: [], messages: early });
    assert.deepEqual(out.map((e) => e.question), [INTRO, CURRENT_CTC]);
    const withExtra = mergeQuestionEvaluations({ planned, evaluations: [...aiOnlyTechnical, { question: "A follow-up the AI invented", score: 6 }], excludedTexts: [], messages });
    assert.equal(withExtra.length, 6);
    assert.equal(withExtra[5].question, "A follow-up the AI invented");
  });

  it("returns the AI list untouched when no saved questions are known", () => {
    assert.deepEqual(mergeQuestionEvaluations({ planned: null, evaluations: aiOnlyTechnical, excludedTexts: [], messages }), aiOnlyTechnical);
  });
});

describe("report data: all questions listed, only technical ones scored", () => {
  const planned = [
    { text: INTRO, order: 0, validationRules: { excludeFromScore: true } },
    { text: EXPECTED_CTC, order: 1, validationRules: { excludeFromScore: true } },
    { text: "Explain the event loop in Node.js.", order: 2 },
  ];
  const d = {
    insights: { questionEvaluations: [{ question: "Explain the event loop in Node.js.", score: 3, evaluation: "Thin." }], criteriaEvaluations: [] },
    interviewQuestions: planned,
    excludedQuestionTexts: [INTRO, EXPECTED_CTC],
    messages: [
      { id: "1", role: "ASSISTANT", contentType: "TEXT", content: INTRO, timestamp: "2026-01-01T10:00:00Z" },
      { id: "2", role: "USER", contentType: "TEXT", content: "I am Asha.", timestamp: "2026-01-01T10:00:05Z" },
      { id: "3", role: "ASSISTANT", contentType: "TEXT", content: EXPECTED_CTC, timestamp: "2026-01-01T10:00:10Z" },
      { id: "4", role: "USER", contentType: "TEXT", content: "Fifteen lakhs.", timestamp: "2026-01-01T10:00:15Z" },
      { id: "5", role: "ASSISTANT", contentType: "TEXT", content: "Explain the event loop in Node.js.", timestamp: "2026-01-01T10:00:20Z" },
      { id: "6", role: "USER", contentType: "TEXT", content: "A loop for callbacks.", timestamp: "2026-01-01T10:00:25Z" },
    ],
  };

  it("lists every question with the candidate's answer; counts are explicit", () => {
    const r = buildReportData(d);
    assert.equal(r.questions.length, 3);
    assert.deepEqual(r.questions.map((q) => q.index), [1, 2, 3]);
    assert.deepEqual(r.questions.map((q) => q.score), [null, null, 3]);
    assert.equal(r.questions[0].answerExcerpt, "I am Asha.");
    assert.equal(r.questions[1].answerExcerpt, "Fifteen lakhs.");
    assert.equal(r.questionsAnswered, 3);
    assert.equal(r.questionsScored, 1);
  });

  it("the overall score only uses the AI technical question", () => {
    assert.equal(buildReportData(d).overallScore, 3);
  });

  it("old sessions without the question list behave as before", () => {
    const r = buildReportData({ ...d, interviewQuestions: undefined, excludedQuestionTexts: undefined });
    assert.equal(r.questions.length, 1);
    assert.equal(r.questionsScored, 1);
  });
});

describe("ensureIntroQuestion", () => {
  it("detects intro wording via isIntroQuestion", () => {
    assert.equal(isIntroQuestion(INTRO), true);
    assert.equal(isIntroQuestion("Tell me about yourself"), true);
    assert.equal(isIntroQuestion(STANDARD_INTRO_EN), true);
    assert.equal(isIntroQuestion(STANDARD_INTRO_HI), true);
    assert.equal(isIntroQuestion("Explain how a hash map works."), false);
  });

  it("inserts a standard English intro when none exists and keeps every technical question", () => {
    const tech = [t("Explain closures."), t("Design a cache.")];
    const out = ensureIntroQuestion(tech);
    assert.equal(out.length, 3);
    assert.equal(out[0].text, STANDARD_INTRO_EN);
    assert.equal((out[0].validationRules as { excludeFromScore?: boolean }).excludeFromScore, true);
    assert.equal(out[0].description, "From General section");
    assert.deepEqual(out.slice(1).map((q) => q.text), ["Explain closures.", "Design a cache."]);
    assert.deepEqual(out.map((q) => q.order), [0, 1, 2]);
  });

  it("inserts a Hinglish intro for Hindi interviews", () => {
    const out = ensureIntroQuestion([t("React hooks ko explain kijiye.")], { language: "hi" });
    assert.equal(out[0].text, STANDARD_INTRO_HI);
    assert.equal(standardIntroText("Hinglish (Hindi-English mix)"), STANDARD_INTRO_HI);
    assert.equal(out[1].text, "React hooks ko explain kijiye.");
  });

  it("uses an existing bank intro, puts it first, stamps it unscored, and drops a duplicate AI intro without losing technical questions", () => {
    const bankIntro = t("Please tell me about yourself and introduce yourself.");
    const tech = [t("Explain the event loop."), t("Tell me about yourself"), t("How do you index a table?")];
    const out = ensureIntroQuestion([bankIntro, ...tech]);
    assert.equal(out.length, 3);
    assert.equal(out[0].text, bankIntro.text);
    assert.equal((out[0].validationRules as { excludeFromScore?: boolean }).excludeFromScore, true);
    assert.ok(!out.slice(1).some((q) => isIntroQuestion(q.text)));
    assert.deepEqual(out.slice(1).map((q) => q.text), ["Explain the event loop.", "How do you index a table?"]);
  });

  it("uses an AI intro when the bank has none, stamps it unscored, and keeps the technical count", () => {
    const out = ensureIntroQuestion([
      t("Explain closures."),
      t("Tell me about yourself"),
      t("Design a cache."),
    ]);
    assert.equal(out[0].text, "Tell me about yourself");
    assert.equal((out[0].validationRules as { excludeFromScore?: boolean }).excludeFromScore, true);
    assert.deepEqual(out.slice(1).map((q) => q.text), ["Explain closures.", "Design a cache."]);
  });

  it("finalizeGeneratedQuestions adds an intro even when there are no premade questions", () => {
    const tech = [t("Explain closures."), t("Design a cache.")];
    const out = finalizeGeneratedQuestions(tech, []);
    assert.equal(out[0].text, STANDARD_INTRO_EN);
    assert.equal(out.length, 3);
    const withPremadeNoIntro = finalizeGeneratedQuestions(
      tech,
      [{ text: CURRENT_CTC, sectionName: "HR" }],
    );
    assert.equal(withPremadeNoIntro[0].text, STANDARD_INTRO_EN);
    assert.equal(withPremadeNoIntro[1].text, CURRENT_CTC);
    assert.deepEqual(withPremadeNoIntro.slice(2).map((q) => q.text), ["Explain closures.", "Design a cache."]);
  });
});

describe("intro questions are never scored", () => {
  it("isQuestionTextExcluded treats an unstamped intro as excluded", () => {
    assert.equal(isQuestionTextExcluded("Tell me about yourself", []), true);
    assert.equal(isQuestionTextExcluded(STANDARD_INTRO_EN, []), true);
    assert.equal(isQuestionTextExcluded("Explain closures.", []), false);
  });

  it("collectExcludedScoreTexts includes intro wording without a stamped flag", () => {
    const texts = collectExcludedScoreTexts(
      [{ text: "Tell me about yourself" }, { text: "genuine AI Q" }],
      [],
    );
    assert.ok(texts.includes("Tell me about yourself"));
    assert.ok(!texts.includes("genuine AI Q"));
  });

  it("an unstamped intro is Not scored in the report and left out of overall score", () => {
    const planned = [
      { text: "Tell me about yourself", order: 0 },
      { text: "Explain the event loop in Node.js.", order: 1 },
    ];
    const messages = [
      { role: "assistant", content: "Tell me about yourself" },
      { role: "user", content: "I am Asha." },
      { role: "assistant", content: "Explain the event loop in Node.js." },
      { role: "user", content: "A loop for callbacks." },
    ];
    const out = mergeQuestionEvaluations({
      planned,
      evaluations: [
        { question: "Tell me about yourself", score: 9, evaluation: "Good intro." },
        { question: "Explain the event loop in Node.js.", score: 3, evaluation: "Thin." },
      ],
      excludedTexts: [],
      messages,
    });
    assert.equal(out[0].score, null);
    assert.equal(out[0].excludeFromScore, true);
    assert.equal(out[1].score, 3);
    const r = buildReportData({
      insights: { questionEvaluations: out, criteriaEvaluations: [] },
      interviewQuestions: planned,
      excludedQuestionTexts: [],
      messages: messages.map((m, i) => ({
        id: String(i),
        role: m.role.toUpperCase(),
        contentType: "TEXT",
        content: m.content,
        timestamp: `2026-01-01T10:00:0${i}Z`,
      })),
    });
    assert.equal(r.questions[0].score, null);
    assert.equal(r.overallScore, 3);
    assert.equal(r.questionsScored, 1);
  });
});

