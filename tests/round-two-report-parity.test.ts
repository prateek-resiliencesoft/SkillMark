import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundTwoReportView } from "@/components/round-two/report-view";
import {
  DEFAULT_ROUND2_CRITERIA,
  buildBasis,
  buildIntegrity,
  criteriaFor,
  hasNothingToEvaluate,
  insufficientEvidenceReport,
  normalizeCriteriaEvaluations,
  normalizeInsights,
  normalizeWhiteboardEvaluations,
  scoreBreakdownOf,
  transcriptSourceOf,
  verifiedQuotes,
  whiteboardPromptSection,
  whiteboardSummary,
} from "@/lib/round-two/report-extras";
import type { WhiteboardInput } from "@/lib/round-two/report-extras";
import type { RoundTwoReport } from "@/lib/round-two/types";

// tsx compiles the component with the classic JSX runtime in tests; the app (Next) uses the automatic one.
(globalThis as unknown as { React: typeof React }).React = React;

const CAND = "I built the payments service in Go. We cut p99 latency from 800 ms to 200 ms. I led a team of four engineers.";

describe("round 2 report: criteria", () => {
  it("uses the interview's criteria, else the defaults", () => {
    assert.equal(criteriaFor(null).custom, false);
    assert.deepEqual(criteriaFor([]).criteria, DEFAULT_ROUND2_CRITERIA);
    const c = criteriaFor([{ name: "React", description: "hooks" }, { name: "", description: "x" }, "junk"]);
    assert.equal(c.custom, true);
    assert.deepEqual(c.criteria, [{ name: "React", description: "hooks" }]);
  });

  it("keeps only asked-for criteria, once, clamped 1-10, drops null / unscored", () => {
    const criteria = [{ name: "React", description: "" }, { name: "SQL", description: "" }, { name: "Testing", description: "" }];
    const out = normalizeCriteriaEvaluations(
      [
        { name: "react", score: 14, reasoning: "good" },
        { name: "React", score: 2, reasoning: "dup" },
        { name: "SQL", score: null, reasoning: "no evidence" },
        { name: "Invented", score: 9, reasoning: "x" },
        { name: "Testing", score: "6", reasoning: "ok" },
      ],
      criteria,
    );
    assert.deepEqual(out.map((c) => [c.name, c.score]), [["React", 10], ["Testing", 6]]);
    assert.deepEqual(normalizeCriteriaEvaluations("nope", criteria), []);
  });
});

describe("round 2 report: insights", () => {
  it("keeps only quotes that are in the candidate's words", () => {
    const q = verifiedQuotes(["We cut p99 latency from 800 ms to 200 ms", "I won a Nobel prize"], CAND);
    assert.equal(q.length, 1);
    assert.match(q[0], /p99 latency/);
    assert.deepEqual(verifiedQuotes(["anything"], ""), []);
  });

  it("normalizes themes, sentiment and tone; rejects bad enums", () => {
    const x = normalizeInsights(
      {
        themes: ["Go", " ", "Leadership"],
        keyInsights: ["Led a team"],
        notableQuotes: ["I led a team of four engineers"],
        sentiment: { overall: "positive", details: "engaged" },
        toneAnalysis: { overall: "very confident", details: "x" },
      },
      CAND,
    );
    assert.deepEqual(x.themes, ["Go", "Leadership"]);
    assert.equal(x.sentiment?.overall, "positive");
    assert.equal(x.toneAnalysis, undefined);
    assert.equal(x.notableQuotes?.length, 1);
  });
});

describe("round 2 report: whiteboard", () => {
  const data = JSON.stringify({
    elements: [
      { type: "rectangle" }, { type: "rectangle" }, { type: "arrow" },
      { type: "text", text: "API gateway" }, { type: "text", text: "  " }, { type: "text", text: "DB", isDeleted: true },
    ],
  });
  it("reads labels and shape counts, ignoring deleted and blank", () => {
    assert.deepEqual(whiteboardSummary(data), { texts: ["API gateway"], shapes: { rectangle: 2, arrow: 1 } });
    assert.equal(whiteboardSummary("not json"), null);
    assert.equal(whiteboardSummary(JSON.stringify({ elements: [] })), null);
  });
  it("scores a whiteboard only when it has content and only for tasks we sent", () => {
    const items: WhiteboardInput[] = [
      { taskId: "wb1", label: "Design", submitted: true, texts: ["API gateway"], shapes: { rectangle: 2 } },
      { taskId: "wb2", label: "Empty", submitted: false, texts: [], shapes: {} },
    ];
    const out = normalizeWhiteboardEvaluations(
      [{ taskId: "wb1", observation: "ok", score: 7 }, { taskId: "wb2", observation: "blank", score: 5 }, { taskId: "zzz", observation: "?", score: 9 }],
      items,
    );
    assert.deepEqual(out.map((w) => [w.taskId, w.score]), [["wb1", 7], ["wb2", null]]);
    assert.match(whiteboardPromptSection(items), /image is NOT available/);
    assert.equal(whiteboardPromptSection([]), "");
  });
});

describe("round 2 report: basis, fallback and integrity", () => {
  const live = [{ speakerRole: "candidate", participantId: "cand:1", text: "one two three" }, { speakerRole: "interviewer", participantId: "user:1", text: "q" }];
  const rec = [{ speakerRole: "candidate", participantId: "recording:candidate", text: "one two" }];
  it("tells where the transcript came from", () => {
    assert.equal(transcriptSourceOf([]), "none");
    assert.equal(transcriptSourceOf(live), "live");
    assert.equal(transcriptSourceOf([...live, ...rec]), "recording");
  });
  const base = { tasksGiven: 0, tasksSubmitted: 0, whiteboardTasks: 0, hasRecording: false, hasNotes: false, hasScorecards: false };
  it("says plainly when there is no transcript and what the report rests on", () => {
    const b = buildBasis({ ...base, rows: [], tasksGiven: 2, tasksSubmitted: 1, hasScorecards: true });
    assert.equal(b.transcript, "none");
    assert.match(b.notes[0], /No transcript was captured/);
    assert.match(b.notes[0], /coding and whiteboard tasks/);
    assert.match(b.notes[0], /panel scorecards/);
    assert.equal(hasNothingToEvaluate(b, false, true), false);
  });
  it("nothing at all → nothing to evaluate; a report from tasks alone is still allowed", () => {
    const none = buildBasis({ ...base, rows: [] });
    assert.equal(hasNothingToEvaluate(none, false, false), true);
    assert.match(none.notes[0], /no other data/);
    const tasksOnly = buildBasis({ ...base, rows: [], tasksGiven: 1 });
    assert.equal(hasNothingToEvaluate(tasksOnly, false, false), false);
    const noSpeech = buildBasis({ ...base, rows: [{ speakerRole: "interviewer", text: "hello" }] });
    assert.equal(noSpeech.candidateWords, 0);
    assert.match(noSpeech.notes[0], /no candidate speech/);
    assert.equal(buildBasis({ ...base, rows: live }).candidateWords, 3);
  });
  it("the placeholder report is flagged and carries no invented findings", () => {
    const r = insufficientEvidenceReport(buildBasis({ ...base, rows: [] }), {
      style: { round1: null, round2: null, notes: [] },
      panel: [],
      integrity: { notes: [], snapshotCount: 0 },
    });
    assert.equal(r.insufficientEvidence, true);
    assert.equal(r.confidence, 0);
    assert.deepEqual([r.strengths, r.concerns, r.questions], [[], [], []]);
    assert.deepEqual(r.scoreBreakdown, { questions: null, criteria: null, coding: null });
  });
  it("integrity notes come from flags, tasks, snapshots and the recording", () => {
    const i = buildIntegrity({
      flags: [
        { kind: "contradiction", detail: "Said 3 years, CV says 1", verified: true },
        { kind: "inconsistency", detail: "Not in transcript", verified: false },
      ] as never,
      snapshotCount: 0,
      hasRecording: false,
      tasksGiven: 3,
      tasksSubmitted: 1,
      styleNotes: ["Filler words doubled"],
    });
    const t = i.notes.join("\n");
    assert.match(t, /contradiction.*Said 3 years/);
    assert.match(t, /1 more flag.*unconfirmed/);
    assert.match(t, /2 of 3 task\(s\) were not submitted/);
    assert.match(t, /No camera snapshots/);
    assert.match(t, /No audio recording/);
    assert.match(t, /Filler words doubled/);
    assert.ok(!/Not in transcript/.test(t));
  });
  it("score averages are computed from the scores, not generated", () => {
    const b = scoreBreakdownOf({
      questions: [
        { question: "a", answerSummary: "", score: 8 },
        { question: "b", answerSummary: "", score: 6 },
        { question: "c", answerSummary: "", score: 0 },
      ],
      criteriaEvaluations: [{ name: "React", score: 9, reasoning: "" }],
      codeEvaluations: [],
    });
    assert.deepEqual(b, { questions: 7, criteria: 9, coding: null });
  });
});

const report = (over: Partial<RoundTwoReport> = {}): RoundTwoReport => ({
  summary: "Solid candidate.",
  recommendation: "yes",
  confidence: 0.7,
  overallScore: 7.5,
  strengths: ["Go"],
  concerns: ["Testing"],
  questions: [{ question: "Tell me about payments", answerSummary: "Built it", score: 8, highlights: ["metrics"], improvements: ["more on tests"] }],
  round1Comparison: { consistency: "consistent", notes: [], contradictions: [] },
  style: { round1: null, round2: null, notes: [] },
  panel: [],
  generatedAt: "2026-11-27T00:00:00Z",
  ...over,
});

describe("round 2 report: view", () => {
  const html = (r: RoundTwoReport) => renderToStaticMarkup(createElement(RoundTwoReportView, { report: r }));
  it("shows skills, insights, whiteboard, integrity and highlights", () => {
    const out = html(
      report({
        criteriaEvaluations: [{ name: "React", score: 9, reasoning: "Strong hooks" }],
        themes: ["Leadership"],
        sentiment: { overall: "positive", details: "engaged" },
        toneAnalysis: { overall: "confident", details: "direct" },
        keyInsights: ["Led a team"],
        notableQuotes: ["I led a team of four engineers"],
        whiteboardEvaluations: [{ taskId: "wb", label: "Design", observation: "gateway + db", score: null }],
        integrity: { notes: ["3 camera snapshot(s) saved for review."], snapshotCount: 3 },
        scoreBreakdown: { questions: 8, criteria: 9, coding: null },
        basis: { transcript: "recording", transcriptLines: 10, candidateWords: 120, tasksGiven: 2, tasksSubmitted: 1, whiteboardTasks: 1, hasRecording: true, notes: [] },
      }),
    );
    for (const needle of ["Skills", "React", "9.0/10", "Leadership", "Sentiment: positive", "Tone: confident", "Led a team", "I led a team of four engineers", "Whiteboard", "not scored", "Integrity and evidence", "3 camera snapshot", "Questions avg", "recording transcript", "metrics", "more on tests"]) {
      assert.ok(out.includes(needle), `missing: ${needle}`);
    }
  });
  it("an old report (no new fields) still renders", () => {
    const out = html(report());
    assert.ok(out.includes("Solid candidate."));
    assert.ok(!out.includes("Integrity and evidence"));
  });
  it("no data: no score or recommendation is shown, the limit is", () => {
    const out = html(
      insufficientEvidenceReport(buildBasis({ rows: [], tasksGiven: 0, tasksSubmitted: 0, whiteboardTasks: 0, hasRecording: false, hasNotes: false, hasScorecards: false }), {
        style: { round1: null, round2: null, notes: [] },
        panel: [],
        integrity: { notes: ["No camera snapshots were saved"], snapshotCount: 0 },
      }),
    );
    assert.ok(out.includes("Not enough data to score"));
    assert.ok(out.includes("Nothing could be evaluated"));
    assert.ok(!out.includes("out of 10"));
  });
  it("a no-transcript report shows the limits banner", () => {
    const out = html(report({ basis: { transcript: "none", transcriptLines: 0, candidateWords: 0, tasksGiven: 1, tasksSubmitted: 1, whiteboardTasks: 0, hasRecording: false, notes: ["No transcript was captured for this round, so this report rests on the coding and whiteboard tasks."] } }));
    assert.ok(out.includes("No transcript was captured"));
  });
});

describe("round 2 report: ordering and wiring", () => {
  const src = readFileSync("src/server/round-two/report.ts", "utf8");
  it("transcript step runs first and the report gathers only after it", () => {
    assert.match(src, /addEdge\(START, "media"\)/);
    assert.match(src, /addEdge\("media", "gather"\)/);
    // gather reads the transcript table itself, after the media step finished.
    assert.ok(src.indexOf('"media"') < src.indexOf('"gather"'));
  });
  it("draft → insights → code review (or verify); nothing-to-evaluate skips the model", () => {
    assert.match(src, /addEdge\("draft", "insights"\)/);
    assert.match(src, /addConditionalEdges\(\s*"insights"/);
    assert.match(src, /addEdge\("insufficient", "save"\)/);
    assert.match(src, /"extract_evidence", "style", "insufficient"/);
  });
  it("the model call uses the org's routing and the interview language", () => {
    assert.match(src, /task: "round2_report"/);
    assert.match(src, /reportLanguageInstruction\(s\.language\)/);
  });
  it("status + retry are reachable in the UI", () => {
    const page = readFileSync("src/app/(dashboard)/round-two/[id]/page.tsx", "utf8");
    assert.match(page, /Regenerate report/);
    assert.match(page, /Report generation failed/);
    assert.match(page, /Transcribing the recording, then writing the report/);
  });
});
