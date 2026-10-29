import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_QUESTION_BANK_SECTIONS, questionBankRouter } from "../src/server/routers/question-bank";

describe("Question Bank Router & Defaults", () => {
  it("defines default standard rounds: Screening, Technical, and HR", () => {
    const names = DEFAULT_QUESTION_BANK_SECTIONS.map((s) => s.name);
    assert.ok(names.includes("Screening Round"));
    assert.ok(names.includes("Technical Round"));
    assert.ok(names.includes("HR Round"));
  });

  it("includes starter questions with descriptions and proper ordering in every default round", () => {
    for (const section of DEFAULT_QUESTION_BANK_SECTIONS) {
      assert.ok(section.questions.length >= 2, `${section.name} should have at least 2 questions`);
      for (const q of section.questions) {
        assert.ok(typeof q.text === "string" && q.text.length > 10);
        assert.ok(typeof q.type === "string");
        assert.equal(typeof q.order, "number");
      }
    }
  });

  it("exports required questionBank router procedures", () => {
    const procedures = Object.keys(questionBankRouter._def.procedures);
    assert.ok(procedures.includes("list"));
    assert.ok(procedures.includes("createSection"));
    assert.ok(procedures.includes("updateSection"));
    assert.ok(procedures.includes("deleteSection"));
    assert.ok(procedures.includes("createItem"));
    assert.ok(procedures.includes("updateItem"));
    assert.ok(procedures.includes("toggleItem"));
    assert.ok(procedures.includes("deleteItem"));
    assert.ok(procedures.includes("getEnabledQuestions"));
  });
});
