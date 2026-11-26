import assert from "node:assert/strict";
import test from "node:test";

import { assessCandidateCapture } from "@/lib/transcript/capture-check";
import { alignCandidateTurns } from "@/lib/transcript/align";
import { isUniformSample, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, pickCaptureScale } from "@/lib/report-pdf";

test("capture check: 9 interviewer lines and 0 candidate lines is a capture failure", () => {
  const msgs = Array.from({ length: 9 }, (_, i) => ({ role: "ASSISTANT", content: `Question ${i + 1}?` }));
  const r = assessCandidateCapture(msgs);
  assert.equal(r.failed, true);
  assert.equal(r.assistantLines, 9);
  assert.equal(r.candidateWords, 0);
});

test("capture check: real answers (lower- or upper-case roles) are not a failure", () => {
  const msgs = [
    { role: "assistant", content: "Q1" },
    { role: "user", content: "I built the payments service in Go with Postgres" },
    { role: "ASSISTANT", content: "Q2" },
    { role: "ASSISTANT", content: "Q3" },
  ];
  assert.equal(assessCandidateCapture(msgs).failed, false);
});

test("capture check: very short sessions are left alone", () => {
  assert.equal(assessCandidateCapture([{ role: "assistant", content: "Hi" }]).failed, false);
});

test("align: candidate turns land between the right interviewer messages, in order", () => {
  const anchors = [
    { timestamp: "2026-11-12T17:00:30.000Z", questionId: "q1" },
    { timestamp: "2026-11-12T17:02:17.000Z", questionId: "q2" },
    { timestamp: "2026-11-12T17:04:50.000Z", questionId: "q3" },
  ];
  const out = alignCandidateTurns(
    [
      { speaker: "interviewer", afterLine: 1, text: "Welcome" },
      { speaker: "candidate", afterLine: 1, text: "Hi, I am Neeraj." },
      { speaker: "candidate", afterLine: 1, text: "I work at MindPath." },
      { speaker: "candidate", afterLine: 2, text: "We used micro frontends." },
      { speaker: "candidate", afterLine: 1, text: "out of order → clamped forward" },
      { speaker: "candidate", afterLine: 3, text: "Socket.IO with Redis adapter." },
      { speaker: "candidate", afterLine: 2, text: "[inaudible]" },
    ],
    anchors,
  );
  assert.equal(out.length, 5);
  const t = out.map((o) => new Date(o.timestamp).getTime());
  const a = anchors.map((x) => new Date(x.timestamp).getTime());
  assert.ok(t[0] > a[0] && t[1] > t[0] && t[1] < a[1]);
  assert.equal(out[0].questionId, "q1");
  assert.ok(t[2] > a[1] && t[2] < a[2]);
  assert.equal(out[3].questionId, "q2"); // clamped to the previous anchor, never backwards
  assert.ok(t[4] > a[2]);
  assert.equal(out[4].questionId, "q3");
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], "timestamps strictly increase");
});

test("align: no candidate speech → nothing to insert", () => {
  assert.deepEqual(alignCandidateTurns([{ speaker: "interviewer", text: "Hello" }], []), []);
});

test("pdf: capture scale keeps the canvas under the size limits", () => {
  // The broken export: 1651 × 7436 CSS px at scale 2 = 3302 × 14872 (49MP).
  const s = pickCaptureScale(1651, 7436, 2);
  assert.ok(1651 * s * 7436 * s <= MAX_CANVAS_PIXELS + 1);
  assert.ok(7436 * s <= MAX_CANVAS_SIDE);
  assert.equal(pickCaptureScale(800, 1200, 2), 2); // small reports keep full quality
});

test("pdf: blank (single-colour) render is detected", () => {
  const black = new Uint8ClampedArray(48 * 48 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  assert.equal(isUniformSample(black), true);
  const content = new Uint8ClampedArray(black);
  content.fill(255, 0, 400); // some white pixels
  assert.equal(isUniformSample(content), false);
});
