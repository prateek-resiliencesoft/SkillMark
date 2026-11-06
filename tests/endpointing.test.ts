import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeHesitation,
  decideEndpoint,
  looksIncomplete,
  targetSilenceMsForTurn,
} from "@/lib/voice/endpointing";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";

test("detects stutter, trailing filler/conjunction, and cut-off as incomplete", () => {
  assert.equal(looksIncomplete(analyzeHesitation("I I worked on payments", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("We used Redis because", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("The main trade-off was-", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("I think the answer is um", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("matlab", 2000)), true);
});

test("mid-sentence 'like'/'so' in a finished answer is NOT incomplete", () => {
  assert.equal(
    looksIncomplete(
      analyzeHesitation(
        "We used Redis as a cache in front of Postgres so hot reads stayed under 10 milliseconds.",
        9000,
      ),
    ),
    false,
  );
  assert.equal(
    looksIncomplete(
      analyzeHesitation("I actually prefer Postgres for consistency across services.", 7000),
    ),
    false,
  );
});

test("short-but-complete answers are NOT incomplete (no check-in trigger)", () => {
  assert.equal(looksIncomplete(analyzeHesitation("Yes", 800)), false);
  assert.equal(looksIncomplete(analyzeHesitation("We used Redis", 1500)), false);
});

test("complete answers target ~1.5s silence; incomplete hold ~5.5s", () => {
  const done = targetSilenceMsForTurn(
    analyzeHesitation(
      "We scaled the workers horizontally and added a queue for retries.",
      8000,
    ),
  );
  const incomplete = targetSilenceMsForTurn(analyzeHesitation("I I um", 2000));
  assert.equal(done, ENDPOINTING_CONFIG.donePauseMs);
  assert.equal(incomplete, ENDPOINTING_CONFIG.hesitantPauseMs);
  assert.ok(incomplete > done);
  assert.equal(ENDPOINTING_CONFIG.donePauseMs, 1_500);
});

test("clear complete answer ends quickly with end_turn (no check-in)", () => {
  const early = decideEndpoint({
    silenceMs: 500,
    transcript: "We used Redis for caching hot keys across the API tier.",
    speechDurationMs: 7000,
  });
  assert.equal(early.shouldEnd, false);
  assert.equal(early.action, "hold");

  const done = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript: "We used Redis for caching hot keys across the API tier.",
    speechDurationMs: 7000,
  });
  assert.equal(done.shouldEnd, true);
  assert.equal(done.action, "end_turn");
  assert.equal(done.hesitant, false);
  assert.equal(done.reason, "done_pause_elapsed");
});

test("short complete answer ends with end_turn, never check_in", () => {
  const d = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript: "Yes",
    speechDurationMs: 600,
  });
  assert.equal(d.shouldEnd, true);
  assert.equal(d.action, "end_turn");
  assert.equal(d.hesitant, false);
});

test("incomplete answer holds past 1.5s, then check_in only after full hesitant hold", () => {
  const mid = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript: "I I think",
    speechDurationMs: 2500,
  });
  assert.equal(mid.shouldEnd, false);
  assert.equal(mid.hesitant, true);
  assert.equal(mid.action, "hold");
  assert.equal(mid.reason, "holding_for_hesitation");

  const late = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.hesitantPauseMs,
    transcript: "I I think",
    speechDurationMs: 2500,
  });
  assert.equal(late.shouldEnd, true);
  assert.equal(late.action, "check_in");
  assert.equal(late.reason, "hesitant_check_in");
});

test("trailing conjunction at hold expiry requests check_in", () => {
  const d = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.hesitantPauseMs,
    transcript: "We chose Postgres because",
    speechDurationMs: 4000,
  });
  assert.equal(d.action, "check_in");
  assert.equal(d.hesitant, true);
});
