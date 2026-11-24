import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeBugKey,
  shouldRaiseGithubIssue,
  type BugSeverity,
} from "../src/lib/bug-triage/types";

const settings = { errorThreshold: 10, noiseThreshold: 50 };

describe("normalizeBugKey", () => {
  it("slugs and truncates", () => {
    assert.equal(normalizeBugKey("Mic Permission Denied!!!"), "mic-permission-denied");
    assert.equal(normalizeBugKey("  "), "unspecified-bug");
  });
});

describe("shouldRaiseGithubIssue", () => {
  const cases: [BugSeverity, number, boolean][] = [
    ["error", 9, false],
    ["error", 10, true],
    ["critical", 10, true],
    ["warning", 49, false],
    ["warning", 50, true],
    ["info", 50, true],
    ["info", 10, false],
  ];
  for (const [sev, count, want] of cases) {
    it(`${sev} @ ${count} → ${want}`, () => {
      assert.equal(shouldRaiseGithubIssue(sev, count, settings), want);
    });
  }
});
