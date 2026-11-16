import assert from "node:assert/strict";
import test from "node:test";

import { buildSummaryPrompt } from "@/lib/ai/prompts/summary";
import {
  alignCandidateTurns,
  buildEchoIndex,
  isInterviewerEcho,
  planTranscriptReplacement,
  stripInterviewerEcho,
  type StoredMessage,
  type TranscribedTurn,
} from "@/lib/transcript/align";

const Q1 = "Welcome Neeraj! Could you briefly introduce yourself and your work at MindPath Technologies?";
const Q2 = "On the Ebotify platform you rebuilt the frontend using a micro frontend architecture. What challenges did you face?";
const Q3 = "Are you there? Can you hear me?";

const assistantRows: StoredMessage[] = [
  { id: "a1", role: "ASSISTANT", content: Q1, timestamp: "2026-11-11T08:35:40.000Z", questionId: "q1", transcription: null },
  { id: "a2", role: "ASSISTANT", content: Q2, timestamp: "2026-11-11T08:37:40.000Z", questionId: "q2", transcription: null },
  { id: "a3", role: "ASSISTANT", content: Q3, timestamp: "2026-11-11T08:39:40.000Z", questionId: "q2", transcription: null },
];

test("echo: a repeated interviewer question is detected, even lightly misheard", () => {
  const idx = buildEchoIndex([Q1, Q2, Q3]);
  assert.equal(isInterviewerEcho(Q2, idx), true);
  assert.equal(
    isInterviewerEcho("on the e-botify platform you rebuilt the front end using micro frontend architecture what challenges did you face", idx),
    true,
  );
  assert.equal(isInterviewerEcho("Are you there? Can you hear me?", idx), true);
});

test("echo: real answers that reuse some question words are kept", () => {
  const idx = buildEchoIndex([Q1, Q2, Q3]);
  assert.equal(isInterviewerEcho("Yes, I can hear you.", idx), false);
  assert.equal(isInterviewerEcho("Yes", idx), false);
  assert.equal(isInterviewerEcho("I think so", idx), false);
  assert.equal(
    isInterviewerEcho("We split the frontend into micro apps and shared a Storybook component library between them", idx),
    false,
  );
});

test("echo: an echoed question at the start of a candidate turn is stripped, the answer stays", () => {
  const idx = buildEchoIndex([Q1, Q2]);
  const out = stripInterviewerEcho(`${Q2} The hardest part was sharing state, so we used a small event bus.`, idx);
  assert.equal(out, "The hardest part was sharing state, so we used a small event bus.");
});

test("align: echoed interviewer lines labelled as candidate never become answers", () => {
  const out = alignCandidateTurns(
    [
      { speaker: "interviewer", startSec: 2, afterLine: 1, text: Q1 },
      { speaker: "candidate", startSec: 3, afterLine: 1, text: Q1 }, // speaker echo
      { speaker: "candidate", startSec: 10, afterLine: 1, text: "I am Neeraj, I work at MindPath on full stack." },
      { speaker: "interviewer", startSec: 120, afterLine: 2, text: Q2 },
      { speaker: "candidate", startSec: 121, afterLine: 2, text: Q2.toLowerCase() },
    ],
    assistantRows.map((m) => ({ timestamp: m.timestamp, questionId: m.questionId })),
    assistantRows.map((m) => m.content),
  );
  assert.deepEqual(out.map((o) => o.text), ["I am Neeraj, I work at MindPath on full stack."]);
  assert.equal(out[0].questionId, "q1");
});

test("align: recording time wins over a wrong afterLine; order is the fallback", () => {
  const anchors = assistantRows.slice(0, 2).map((m) => ({ timestamp: m.timestamp, questionId: m.questionId }));
  const byTime = alignCandidateTurns(
    [
      { speaker: "interviewer", startSec: 2, afterLine: 1, text: Q1 },
      { speaker: "interviewer", startSec: 120, afterLine: 2, text: Q2 },
      { speaker: "candidate", startSec: 130, afterLine: 1, text: "We used module federation." }, // afterLine is wrong
    ],
    anchors,
  );
  assert.equal(byTime[0].questionId, "q2");
  assert.ok(new Date(byTime[0].timestamp).getTime() > new Date(anchors[1].timestamp).getTime());

  const byOrder = alignCandidateTurns(
    [
      { speaker: "candidate", afterLine: 2, text: "First answer" },
      { speaker: "candidate", text: "Second part, no position given" },
    ],
    anchors,
  );
  assert.deepEqual(byOrder.map((o) => o.questionId), ["q2", "q2"]);
});

test("align: unknown speaker labels are never treated as the candidate", () => {
  const out = alignCandidateTurns(
    [
      { speaker: "AI", afterLine: 1, text: "Tell me about yourself" },
      { speaker: "unknown", afterLine: 1, text: "Something" },
      { afterLine: 1, text: "No label" },
    ],
    [{ timestamp: "2026-11-11T08:35:40.000Z", questionId: "q1" }],
  );
  assert.equal(out.length, 0);
});

const turns: TranscribedTurn[] = [
  { speaker: "interviewer", startSec: 2, afterLine: 1, text: Q1 },
  { speaker: "candidate", startSec: 10, afterLine: 1, text: "I am Neeraj." },
  { speaker: "interviewer", startSec: 120, afterLine: 2, text: Q2 },
  { speaker: "candidate", startSec: 125, afterLine: 2, text: "State sharing was the hard part." },
];

function apply(rows: StoredMessage[], plan: ReturnType<typeof planTranscriptReplacement>, idPrefix: string): StoredMessage[] {
  const kept = rows.filter((r) => !plan.deleteIds.includes(r.id));
  return [
    ...kept,
    ...plan.insert.map((r, i) => ({
      id: `${idPrefix}${i}`,
      role: r.role,
      content: r.text,
      timestamp: r.timestamp,
      questionId: r.questionId,
      transcription: r.transcription,
    })),
  ];
}

test("idempotent: re-running replaces earlier re-transcribed lines instead of stacking them", () => {
  const typed: StoredMessage = {
    id: "typed", role: "USER", content: "typed answer", timestamp: "2026-11-11T08:36:00.000Z", questionId: "q1", transcription: "typed",
  };
  const liveVoice: StoredMessage = {
    id: "live", role: "USER", content: "half captured", timestamp: "2026-11-11T08:36:10.000Z", questionId: "q1", transcription: null,
  };
  let rows = [...assistantRows, typed, liveVoice];

  const p1 = planTranscriptReplacement(rows, turns);
  assert.deepEqual(p1.deleteIds.sort(), ["live"]);
  rows = apply(rows, p1, "r1-");
  const p2 = planTranscriptReplacement(rows, turns);
  rows = apply(rows, p2, "r2-");

  const user = rows.filter((r) => r.role === "USER" && r.transcription === "recording");
  assert.deepEqual(user.map((r) => r.content), ["I am Neeraj.", "State sharing was the hard part."]);
  assert.ok(rows.some((r) => r.id === "typed"), "typed answers are kept");
  // Interviewer rows untouched and never in a delete list.
  assert.deepEqual(rows.filter((r) => r.role === "ASSISTANT"), assistantRows);
  assert.ok(![...p1.deleteIds, ...p2.deleteIds].some((id) => id.startsWith("a")));
  assert.ok([...p1.insert, ...p2.insert].every((r) => r.role === "USER"));
});

test("summary prompt: transcript is labelled Interviewer / Candidate and only candidate lines are scored", () => {
  const msgs = buildSummaryPrompt(
    "Screening",
    [
      { role: "assistant", content: "What is your notice period?" },
      { role: "USER", content: "Thirty days." },
    ],
    null,
    null,
    [{ text: "What is your notice period?", order: 1 }],
  );
  const sys = String(msgs[0].content);
  assert.match(sys, /Interviewer: What is your notice period\?/);
  assert.match(sys, /Candidate: Thirty days\./);
  assert.doesNotMatch(sys, /Participant: /);
  assert.match(sys, /only.*Candidate:/i);
});
