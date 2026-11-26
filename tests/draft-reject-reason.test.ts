import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraftRejectReasonPrompt,
  fallbackDraftRejectReason,
  finalizeDraftRejectReason,
  parseDraftRejectReasonInput,
} from "../src/lib/draft-reject-reason";

test("parseDraftRejectReasonInput rejects empty", () => {
  assert.throws(() => parseDraftRejectReasonInput({}), /Provide a reason draft and\/or tags/);
  assert.throws(() => parseDraftRejectReasonInput({ draft: "   ", tags: [] }), /Provide a reason draft/);
});

test("parseDraftRejectReasonInput accepts draft-only and tags-only", () => {
  assert.deepEqual(parseDraftRejectReasonInput({ draft: "  low score  " }), {
    draft: "low score",
    tags: [],
  });
  const tagged = parseDraftRejectReasonInput({ tags: ["low_score", "culture_fit"] });
  assert.equal(tagged.draft, "");
  assert.deepEqual(tagged.tags, ["low_score", "culture_fit"]);
});

test("buildDraftRejectReasonPrompt asks for complete polite sentences", () => {
  const p = buildDraftRejectReasonPrompt("salary too high", ["low_score"]);
  assert.match(p, /salary too high/);
  assert.match(p, /low_score|Low score/i);
  assert.match(p, /2–3 COMPLETE sentences|2-3 COMPLETE sentences/i);
  assert.match(p, /Never stop mid-sentence/i);
  assert.match(p, /180–420|180-420/i);
  assert.match(p, /candidate/i);
});

test("finalizeDraftRejectReason drops mid-sentence truncation", () => {
  const cut =
    "While we appreciated reviewing your assessment, your overall results were below our bar. Your final score did";
  const out = finalizeDraftRejectReason(cut);
  assert.match(out, /below our bar\.$/);
  assert.doesNotMatch(out, /Your final score did/);
});

test("finalizeDraftRejectReason keeps complete text", () => {
  const full =
    "Thank you for completing the assessment. Your results did not meet the threshold for this role at this time.";
  assert.equal(finalizeDraftRejectReason(full), full);
});

test("fallbackDraftRejectReason prefers complete draft text", () => {
  const draft =
    "Thank you for interviewing. We will not be moving forward based on the overall assessment results.";
  assert.equal(fallbackDraftRejectReason(`  ${draft}  `, ["low_score"]), draft);
});

test("fallbackDraftRejectReason builds from tags when draft empty", () => {
  const text = fallbackDraftRejectReason("", ["low_score"]);
  assert.match(text, /assessment|threshold|results/i);
  assert.match(text, /[.!?]$/);
  assert.ok(text.length >= 80);
  assert.doesNotMatch(text, /low_score/);
});
