import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRejectTags, rejectTagLabel } from "@/lib/reject-tags";

describe("normalizeRejectTags", () => {
  it("keeps presets and custom, trims, dedupes, caps length", () => {
    assert.deepEqual(
      normalizeRejectTags(["cheating", "  Low Score  ", "cheating", "x".repeat(50)]),
      ["cheating", "Low Score", "x".repeat(40)],
    );
  });

  it("drops empties and non-strings", () => {
    assert.deepEqual(normalizeRejectTags([null, "", "  ", 1, "integrity"]), ["integrity"]);
  });

  it("caps at 12 tags", () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    assert.equal(normalizeRejectTags(many).length, 12);
  });
});

describe("rejectTagLabel", () => {
  it("maps preset ids to labels", () => {
    assert.equal(rejectTagLabel("low_score"), "Low score");
  });

  it("returns custom tags as-is", () => {
    assert.equal(rejectTagLabel("no-show"), "no-show");
  });
});
