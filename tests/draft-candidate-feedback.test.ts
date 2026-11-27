import assert from "node:assert/strict";
import test from "node:test";
import {
  FEEDBACK_ENHANCE_MIN,
  buildEnhanceFeedbackPrompt,
  fallbackEnhanceFeedback,
  finalizeEnhanceFeedback,
  parseEnhanceFeedbackInput,
} from "../src/lib/draft-candidate-feedback";

test("parseEnhanceFeedbackInput rejects short or empty", () => {
  assert.throws(() => parseEnhanceFeedbackInput({}), /at least|too short|20/i);
  assert.throws(() => parseEnhanceFeedbackInput({ draft: "   " }), /at least|too short|20/i);
  assert.throws(() => parseEnhanceFeedbackInput({ draft: "x".repeat(FEEDBACK_ENHANCE_MIN - 1) }), /at least|too short|20/i);
});

test("parseEnhanceFeedbackInput accepts trimmed draft ≥ 20", () => {
  const draft = "  The questions were clear but audio lagged a bit.  ";
  assert.deepEqual(parseEnhanceFeedbackInput({ draft }), {
    draft: "The questions were clear but audio lagged a bit.",
  });
});

test("buildEnhanceFeedbackPrompt includes draft and forbids inventing facts", () => {
  const p = buildEnhanceFeedbackPrompt("Audio was choppy and one question repeated.");
  assert.match(p, /Audio was choppy and one question repeated/);
  assert.match(p, /polish|enhance|rewrite/i);
  assert.match(p, /do not invent|without inventing|keep (the )?meaning/i);
  assert.match(p, /Output ONLY/i);
  assert.doesNotMatch(p, /\btags?\b/i);
  assert.doesNotMatch(p, /transcript/i);
});

test("finalizeEnhanceFeedback strips junk and mid-sentence cut", () => {
  const cut = "The interview felt organized overall. The audio quality did";
  const out = finalizeEnhanceFeedback(cut);
  assert.match(out, /organized overall\.$/);
  assert.doesNotMatch(out, /audio quality did/);
});

test("fallbackEnhanceFeedback returns candidate text only", () => {
  const draft = "I liked the pace. A couple of questions felt unclear.";
  assert.equal(fallbackEnhanceFeedback(`  ${draft}  `), draft);
});
