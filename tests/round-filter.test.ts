import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateMatchesRound,
  clampRoundFilter,
  deriveMaxRound,
  interviewMatchesRound,
  type RoundFilterValue,
} from "../src/lib/round-two/round-filter";

test("deriveMaxRound is 1 without R2, 2 with any R2 candidate", () => {
  assert.equal(deriveMaxRound([]), 1);
  assert.equal(deriveMaxRound(["c1"]), 2);
});

test("clampRoundFilter resets when above maxRound", () => {
  assert.equal(clampRoundFilter("ALL", 1), "ALL");
  assert.equal(clampRoundFilter(2, 1), "ALL");
  assert.equal(clampRoundFilter(1, 2), 1);
  assert.equal(clampRoundFilter(2, 2), 2);
});

test("candidateMatchesRound: R1 needs session; R2 needs id set", () => {
  const r2 = new Set(["c-r2"]);
  assert.equal(candidateMatchesRound({ id: "a", hasSession: true }, "ALL", r2), true);
  assert.equal(candidateMatchesRound({ id: "a", hasSession: false }, 1, r2), false);
  assert.equal(candidateMatchesRound({ id: "a", hasSession: true }, 1, r2), true);
  assert.equal(candidateMatchesRound({ id: "c-r2", hasSession: false }, 2, r2), true);
  assert.equal(candidateMatchesRound({ id: "a", hasSession: true }, 2, r2), false);
});

test("interviewMatchesRound: R1 needs sessions; R2 needs interview id set", () => {
  const r2 = new Set(["iv-r2"]);
  assert.equal(interviewMatchesRound({ id: "x", sessionCount: 0 }, 1, r2), false);
  assert.equal(interviewMatchesRound({ id: "x", sessionCount: 2 }, 1, r2), true);
  assert.equal(interviewMatchesRound({ id: "iv-r2", sessionCount: 0 }, 2, r2), true);
  assert.equal(interviewMatchesRound({ id: "x", sessionCount: 1 }, 2, r2), false);
  assert.equal(interviewMatchesRound({ id: "x", sessionCount: 0 }, "ALL" as RoundFilterValue, r2), true);
});
