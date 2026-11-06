import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeHesitation,
  decideEndpoint,
  looksIncomplete,
  targetSilenceMsForTurn,
} from "@/lib/voice/endpointing";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";

test("detects stutter, trailing filler/conjunction/preposition, and cut-off as incomplete", () => {
  assert.equal(looksIncomplete(analyzeHesitation("I I worked on payments", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("We used Redis because", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("I am working for", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("internship in", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("The main trade-off was-", 5000)), true);
  assert.equal(looksIncomplete(analyzeHesitation("I think the answer is um", 5000)), true);
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
});

test("short-but-complete answers are NOT incomplete (no check-in trigger)", () => {
  assert.equal(looksIncomplete(analyzeHesitation("Yes", 800)), false);
  assert.equal(looksIncomplete(analyzeHesitation("We used Redis", 1500)), false);
});

test("short complete answers target ~1.5s; long answers need ~3s; incomplete ~5.5s", () => {
  const shortDone = targetSilenceMsForTurn(
    analyzeHesitation("We scaled the workers horizontally.", 3000),
    3000,
  );
  const longDone = targetSilenceMsForTurn(
    analyzeHesitation(
      "I am a junior developer. I have worked on Flutter apps with Riverpod and Hive.",
      20_000,
    ),
    20_000,
  );
  const incomplete = targetSilenceMsForTurn(analyzeHesitation("I I um", 2000), 2000);
  assert.equal(shortDone, ENDPOINTING_CONFIG.donePauseMs);
  assert.equal(longDone, ENDPOINTING_CONFIG.longAnswerDonePauseMs);
  assert.equal(incomplete, ENDPOINTING_CONFIG.hesitantPauseMs);
  assert.ok(longDone > shortDone);
});

test("clear short complete answer ends quickly with end_turn (no check-in)", () => {
  const done = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript: "We used Redis for caching hot keys across the API tier.",
    speechDurationMs: 4000,
  });
  assert.equal(done.shouldEnd, true);
  assert.equal(done.action, "end_turn");
  assert.equal(done.reason, "done_pause_elapsed");
});

test("long complete answer still holding at 1.5s; ends after longAnswerDonePauseMs", () => {
  const mid = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript:
      "Hello my name is Prabhat. I completed BCA and I have done internships in Java and Python.",
    speechDurationMs: 20_000,
  });
  assert.equal(mid.shouldEnd, false);
  assert.equal(mid.reason, "holding_for_long_answer_pause");

  const late = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.longAnswerDonePauseMs,
    transcript:
      "Hello my name is Prabhat. I completed BCA and I have done internships in Java and Python.",
    speechDurationMs: 20_000,
  });
  assert.equal(late.shouldEnd, true);
  assert.equal(late.action, "end_turn");
  assert.equal(late.reason, "long_answer_done_pause_elapsed");
});

test("incomplete answer holds then check_in only after full hesitant hold", () => {
  const mid = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.donePauseMs,
    transcript: "I I think",
    speechDurationMs: 2500,
  });
  assert.equal(mid.shouldEnd, false);
  assert.equal(mid.action, "hold");

  const late = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.hesitantPauseMs,
    transcript: "I I think",
    speechDurationMs: 2500,
  });
  assert.equal(late.shouldEnd, true);
  assert.equal(late.action, "check_in");
});

test("trailing preposition at hold expiry requests check_in", () => {
  const d = decideEndpoint({
    silenceMs: ENDPOINTING_CONFIG.hesitantPauseMs,
    transcript: "currently I am working for",
    speechDurationMs: 4000,
  });
  assert.equal(d.action, "check_in");
  assert.equal(d.hesitant, true);
});
