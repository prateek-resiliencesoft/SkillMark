import assert from "node:assert/strict";
import test from "node:test";

import {
  collectExcludedScoreTexts,
  isQuestionTextExcluded,
  shouldExcludePremadeFromScore,
} from "../src/lib/premade-sections";
import {
  applyQuestionScoreExclusions,
  getSessionOverallScore,
  getSessionScoreBreakdown,
  usesQuestionEvaluationScore,
} from "../src/lib/session-score";

test("getSessionOverallScore prefers question-by-question evaluations", () => {
  const insights = {
    questionEvaluations: [{ score: 8 }, { score: 6 }],
    criteriaEvaluations: [{ score: 10 }, { score: 10 }],
  };

  assert.equal(getSessionOverallScore(insights), 7);
  assert.equal(usesQuestionEvaluationScore(insights), true);
});

test("getSessionOverallScore falls back to criteria for legacy sessions", () => {
  const insights = {
    criteriaEvaluations: [{ score: 9 }, { score: 7 }],
  };

  assert.equal(getSessionOverallScore(insights), 8);
  assert.equal(usesQuestionEvaluationScore(insights), false);
});

test("getSessionOverallScore parses numeric strings and ignores invalid values", () => {
  const insights = {
    questionEvaluations: [
      { score: "9.5" },
      { score: "invalid" },
      { score: null },
    ],
    criteriaEvaluations: [{ score: 2 }],
  };

  assert.equal(getSessionOverallScore(insights), 9.5);
  assert.equal(usesQuestionEvaluationScore(insights), true);
});

test("getSessionOverallScore returns null when no valid scores exist", () => {
  const insights = {
    questionEvaluations: [{ score: null }, { score: "NaN" }],
    criteriaEvaluations: [],
  };

  assert.equal(getSessionOverallScore(insights), null);
  assert.equal(usesQuestionEvaluationScore(insights), false);
});

test("getSessionScoreBreakdown splits questions, skills and coding", () => {
  const breakdown = getSessionScoreBreakdown({
    questionEvaluations: [
      { question: "Tell me about yourself", score: 8 },
      { question: "System design", score: 6 },
    ],
    criteriaEvaluations: [{ name: "Communication", score: 7 }],
    codeEvaluations: [
      { snippetLabel: "two-sum.py", language: "python", score: 9 },
    ],
  });

  assert.equal(breakdown.overall, 7);
  assert.equal(breakdown.source, "questions");
  assert.equal(breakdown.questions.avg, 7);
  assert.equal(breakdown.criteria.avg, 7);
  assert.equal(breakdown.coding.avg, 9);
  assert.equal(breakdown.coding.items[0]?.label, "two-sum.py");
  assert.match(breakdown.questions.items[0]?.label ?? "", /^Q1\./);
});

test("shouldExcludePremadeFromScore: any bank section out, empty in (AI complementary)", () => {
  assert.equal(shouldExcludePremadeFromScore("Screening Round"), true);
  assert.equal(shouldExcludePremadeFromScore("HR Round"), true);
  assert.equal(shouldExcludePremadeFromScore("Technical Round"), true);
  assert.equal(shouldExcludePremadeFromScore("Custom Preset"), true);
  assert.equal(shouldExcludePremadeFromScore(""), false);
  assert.equal(shouldExcludePremadeFromScore(undefined), false);
});

test("applyQuestionScoreExclusions marks screening texts and overall ignores them", () => {
  const evals = applyQuestionScoreExclusions(
    [
      { question: "what is current ctc", score: 9 },
      { question: "Explain React reconciliation", score: 6 },
      { question: "are you willing to relocate to Bilaspur chhatisgarh", score: 10 },
    ],
    [
      "what is current ctc",
      "are you willing to relocate to Bilaspur chhatisgarh",
    ],
  );

  assert.equal(evals[0]?.excludeFromScore, true);
  assert.equal(evals[1]?.excludeFromScore, undefined);
  assert.equal(evals[2]?.excludeFromScore, true);

  assert.equal(
    getSessionOverallScore({ questionEvaluations: evals }),
    6,
  );
  assert.equal(
    getSessionScoreBreakdown({ questionEvaluations: evals }).questions.avg,
    6,
  );
});

test("getSessionOverallScore skips excludeFromScore entries already on insights", () => {
  const insights = {
    questionEvaluations: [
      { question: "CTC?", score: 10, excludeFromScore: true },
      { question: "System design", score: 4 },
      { question: "Notice period?", score: 9, excludeFromScore: true },
    ],
  };
  assert.equal(getSessionOverallScore(insights), 4);
});

test("collectExcludedScoreTexts uses flag, From-section desc, and all bank sections", () => {
  const texts = collectExcludedScoreTexts(
    [
      { text: "stamped CTC", validationRules: { excludeFromScore: true } },
      { text: "desc relocate", description: "From Screening Round section" },
      { text: "tech design", description: "From Technical Round section" },
      { text: "genuine AI Q", description: null },
    ],
    [
      { text: "bank HR culture", sectionName: "HR Round" },
      { text: "bank tech arch", sectionName: "Technical Round" },
    ],
  );
  assert.ok(texts.includes("stamped CTC"));
  assert.ok(texts.includes("desc relocate"));
  assert.ok(texts.includes("tech design"));
  assert.ok(texts.includes("bank HR culture"));
  assert.ok(texts.includes("bank tech arch"));
  assert.ok(!texts.includes("genuine AI Q"));
});

test("preset score 0 with excludeFromScore does not pull overall down", () => {
  assert.equal(
    getSessionOverallScore({
      questionEvaluations: [
        { question: "CTC?", score: 0, excludeFromScore: true },
        { question: "System design", score: 8 },
        { question: "Tech bank Q", score: 0, excludeFromScore: true },
      ],
    }),
    8,
  );
});

test("applyQuestionScoreExclusions clears numeric score to null", () => {
  const evals = applyQuestionScoreExclusions(
    [
      { question: "Describe a technical project trade-off", score: 4 },
      { question: "Explain Riverpod vs BLoC", score: 6 },
    ],
    ["Describe a technical project trade-off"],
  );
  assert.equal(evals[0]?.excludeFromScore, true);
  assert.equal(evals[0]?.score, null);
  assert.equal(evals[1]?.excludeFromScore, undefined);
  assert.equal(evals[1]?.score, 6);
});

test("zero AI questions (only preset questions) returns null overall even if criteria exist", () => {
  const insights = {
    questionEvaluations: [
      { question: "Introduce yourself", score: null, excludeFromScore: true },
      { question: "Technical trade-offs", score: 7, excludeFromScore: true },
    ],
    criteriaEvaluations: [{ name: "Communication", score: 8 }],
  };
  assert.equal(getSessionOverallScore(insights), null);
  const breakdown = getSessionScoreBreakdown(insights);
  assert.equal(breakdown.overall, null);
  assert.equal(breakdown.source, null);
  assert.equal(breakdown.questions.avg, null);
  assert.equal(breakdown.questions.items.length, 0);
});

test("isQuestionTextExcluded detects flag, section desc, and bank text", () => {
  assert.equal(
    isQuestionTextExcluded("Any", [], { validationRules: { excludeFromScore: true } }),
    true,
  );
  assert.equal(
    isQuestionTextExcluded("Any", [], { description: "From Technical Round section" }),
    true,
  );
  assert.equal(
    isQuestionTextExcluded("Tell me about performance bottlenecks", ["Tell me about performance bottlenecks"]),
    true,
  );
  assert.equal(isQuestionTextExcluded("Compare GetX vs BLoC", ["Notice period?"]), false);
});
