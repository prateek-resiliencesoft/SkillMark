import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDraftRejectReasonPrompt,
  fallbackDraftRejectReason,
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

test("buildDraftRejectReasonPrompt mentions tags and draft", () => {
  const p = buildDraftRejectReasonPrompt("salary too high", ["low_score"]);
  assert.match(p, /salary too high/);
  assert.match(p, /low_score|Low score/i);
  assert.match(p, /1–2 sentences|1-2 sentences/i);
  assert.match(p, /candidate/i);
});

test("fallbackDraftRejectReason prefers draft text", () => {
  assert.equal(fallbackDraftRejectReason("  salary too high  ", ["low_score"]), "salary too high");
});

test("fallbackDraftRejectReason builds from tags when draft empty", () => {
  const text = fallbackDraftRejectReason("", ["low_score"]);
  assert.match(text, /assessment results|threshold/i);
  assert.doesNotMatch(text, /low_score/);
});
