import assert from "node:assert/strict";
import test from "node:test";
import { hasDeclineReason } from "../src/lib/messaging/templates";

test("hasDeclineReason treats whitespace as empty", () => {
  assert.equal(hasDeclineReason(undefined), false);
  assert.equal(hasDeclineReason(null), false);
  assert.equal(hasDeclineReason(""), false);
  assert.equal(hasDeclineReason("   "), false);
  assert.equal(hasDeclineReason("Budget mismatch"), true);
});
