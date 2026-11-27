/**
 * Round 2 report extras (pure, no I/O): the pieces that bring the round 2 report to round 1's
 * level (per-skill scores, themes, sentiment, tone, key insights, quotes, integrity notes) and
 * the honesty fields (what the report was built from, "nothing to evaluate").
 */
import { alignSpan } from "@/lib/ai/extract/align";
import { getSessionScoreBreakdown } from "@/lib/session-score";
import type { CopilotFlag, RoundTwoReport, RoundTwoReportBasis } from "@/lib/round-two/types";

export type Criterion = { name: string; description: string };

/** Used when the round 1 interview defined no assessment criteria. */
export const DEFAULT_ROUND2_CRITERIA: Criterion[] = [
  { name: "Technical knowledge", description: "Depth and accuracy of what the candidate knows for the role" },
  { name: "Problem solving", description: "How they break down problems, including the live tasks" },
  { name: "Communication", description: "Clarity, structure and honesty when explaining their work" },
  { name: "Ownership and experience", description: "Real, checkable experience; owns results and mistakes" },
];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strings = (v: unknown, n: number, max = 400): string[] =>
  Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, n) : [];

/** Criteria the report scores: the interview's own, else the defaults. */
export function criteriaFor(raw: unknown): { criteria: Criterion[]; custom: boolean } {
  const list = Array.isArray(raw)
    ? raw
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return { name: text(o.name, 80), description: text(o.description, 300) };
        })
        .filter((c) => c.name)
        .slice(0, 12)
    : [];
  return list.length ? { criteria: list, custom: true } : { criteria: DEFAULT_ROUND2_CRITERIA, custom: false };
}

/** The model's per-skill scores: only asked-for criteria, 1-10, each once. */
export function normalizeCriteriaEvaluations(raw: unknown, criteria: Criterion[]): NonNullable<RoundTwoReport["criteriaEvaluations"]> {
  if (!Array.isArray(raw)) return [];
  const byName = new Map(criteria.map((c) => [c.name.toLowerCase(), c.name]));
  const seen = new Set<string>();
  const out: NonNullable<RoundTwoReport["criteriaEvaluations"]> = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = byName.get(text(o.name, 80).toLowerCase());
    const score = num(o.score);
    if (!name || score == null || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, score: clamp(score, 1, 10), reasoning: text(o.reasoning, 600) });
  }
  return out;
}

/** Quotes that really are in the candidate's words (same alignment the evidence check uses). */
export function verifiedQuotes(raw: unknown, candidateText: string, max = 6): string[] {
  const out: string[] = [];
  for (const q of strings(raw, 12, 300)) {
    const span = candidateText ? alignSpan(candidateText, q) : null;
    if (span) out.push(candidateText.slice(span.start, span.end));
    if (out.length >= max) break;
  }
  return out;
}

type Extras = Pick<RoundTwoReport, "themes" | "sentiment" | "keyInsights" | "notableQuotes" | "toneAnalysis">;

export function normalizeInsights(data: Record<string, unknown>, candidateText: string): Extras {
  const sent = (data.sentiment ?? {}) as Record<string, unknown>;
  const tone = (data.toneAnalysis ?? {}) as Record<string, unknown>;
  const out: Extras = {
    themes: strings(data.themes, 8, 120),
    keyInsights: strings(data.keyInsights, 8),
    notableQuotes: verifiedQuotes(data.notableQuotes, candidateText),
  };
  if (["positive", "neutral", "negative"].includes(sent.overall as string)) {
    out.sentiment = { overall: sent.overall as "positive", details: text(sent.details) };
  }
  if (["confident", "neutral", "hesitant"].includes(tone.overall as string)) {
    out.toneAnalysis = { overall: tone.overall as "confident", details: text(tone.details) };
  }
  return out;
}

// ── Whiteboard ──────────────────────────────────────────────────────────────

/** Text labels and shape counts from an Excalidraw snapshot (what a model can read without the image). */
export function whiteboardSummary(data: string | null | undefined): { texts: string[]; shapes: Record<string, number> } | null {
  if (!data) return null;
  try {
    const els = (JSON.parse(data) as { elements?: unknown }).elements;
    if (!Array.isArray(els)) return null;
    const texts: string[] = [];
    const shapes: Record<string, number> = {};
    for (const e of els) {
      const o = (e ?? {}) as Record<string, unknown>;
      if (o.isDeleted === true) continue;
      const type = typeof o.type === "string" ? o.type : "other";
      if (type === "text") {
        const t = text(o.text, 200);
        if (t) texts.push(t);
      } else shapes[type] = (shapes[type] ?? 0) + 1;
    }
    return texts.length || Object.keys(shapes).length ? { texts: texts.slice(0, 80), shapes } : null;
  } catch {
    return null;
  }
}

export type WhiteboardInput = { taskId: string; label: string; submitted: boolean; texts: string[]; shapes: Record<string, number> };

export function whiteboardPromptSection(items: WhiteboardInput[]): string {
  if (!items.length) return "";
  return `Whiteboard tasks (the drawing image is NOT available to you; only its text labels and shape counts):\n${items
    .map(
      (w, i) =>
        `${i + 1}. [id=${w.taskId}] ${w.label} (${w.submitted ? "candidate submitted" : "not submitted"}): shapes ${
          Object.entries(w.shapes).map(([k, n]) => `${k}×${n}`).join(", ") || "none"
        }; labels: ${w.texts.length ? w.texts.map((t) => `"${t}"`).join(", ") : "(none)"}`,
    )
    .join("\n")}`;
}

/** Whiteboard reviews for the tasks we sent; a score only when the drawing has some content. */
export function normalizeWhiteboardEvaluations(raw: unknown, items: WhiteboardInput[]): NonNullable<RoundTwoReport["whiteboardEvaluations"]> {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(items.map((w) => [w.taskId, w]));
  const out: NonNullable<RoundTwoReport["whiteboardEvaluations"]> = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const w = byId.get(text(o.taskId, 80));
    if (!w || seen.has(w.taskId)) continue;
    seen.add(w.taskId);
    const score = num(o.score);
    const hasContent = w.texts.length > 0 || Object.keys(w.shapes).length > 0;
    out.push({ taskId: w.taskId, label: w.label, observation: text(o.observation, 800), score: hasContent && score != null ? clamp(score, 1, 10) : null });
  }
  return out;
}

// ── Basis, integrity, breakdown ─────────────────────────────────────────────

export type TranscriptRowLite = { speakerRole: string; participantId?: string | null; text: string };

export function transcriptSourceOf(rows: TranscriptRowLite[]): RoundTwoReportBasis["transcript"] {
  if (!rows.length) return "none";
  return rows.some((r) => String(r.participantId ?? "").startsWith("recording:")) ? "recording" : "live";
}

export function buildBasis(input: {
  rows: TranscriptRowLite[];
  tasksGiven: number;
  tasksSubmitted: number;
  whiteboardTasks: number;
  hasRecording: boolean;
  hasNotes: boolean;
  hasScorecards: boolean;
}): RoundTwoReportBasis {
  const transcript = transcriptSourceOf(input.rows);
  const candidateWords = input.rows
    .filter((r) => r.speakerRole === "candidate")
    .reduce((n, r) => n + (r.text.trim() ? r.text.trim().split(/\s+/).length : 0), 0);
  const notes: string[] = [];
  if (transcript === "none") {
    const rests = [input.tasksGiven ? "the coding and whiteboard tasks" : "", input.hasNotes ? "the panel notes" : "", input.hasScorecards ? "the panel scorecards" : ""].filter(Boolean);
    notes.push(`No transcript was captured for this round, so this report rests on ${rests.length ? rests.join(", ") : "no other data"} and cannot assess the spoken answers.`);
  } else if (candidateWords === 0) {
    notes.push("The transcript has no candidate speech, so the spoken answers could not be assessed.");
  } else if (transcript === "live") {
    notes.push("Built from the live transcript (the recording could not be transcribed or was not better).");
  }
  return {
    transcript,
    transcriptLines: input.rows.length,
    candidateWords,
    tasksGiven: input.tasksGiven,
    tasksSubmitted: input.tasksSubmitted,
    whiteboardTasks: input.whiteboardTasks,
    hasRecording: input.hasRecording,
    notes,
  };
}

/** True when no evidence of any kind exists, so a model call would only invent a verdict. */
export function hasNothingToEvaluate(b: RoundTwoReportBasis, hasNotes: boolean, hasScorecards: boolean): boolean {
  return b.candidateWords === 0 && b.tasksGiven === 0 && !hasNotes && !hasScorecards;
}

export function buildIntegrity(input: {
  flags: CopilotFlag[];
  snapshotCount: number;
  hasRecording: boolean;
  tasksGiven: number;
  tasksSubmitted: number;
  styleNotes: string[];
}): NonNullable<RoundTwoReport["integrity"]> {
  const notes: string[] = [];
  const real = input.flags.filter((f) => f.verified !== false);
  for (const f of real.slice(0, 5)) notes.push(`Interview flag (${f.kind}): ${f.detail}`);
  const unverified = input.flags.length - real.length;
  if (unverified > 0) notes.push(`${unverified} more flag(s) raised live could not be matched to the transcript (treat as unconfirmed).`);
  if (input.tasksGiven > input.tasksSubmitted) notes.push(`${input.tasksGiven - input.tasksSubmitted} of ${input.tasksGiven} task(s) were not submitted by the candidate.`);
  if (input.snapshotCount === 0) notes.push("No camera snapshots were saved (camera off, or the candidate did not join with video).");
  else notes.push(`${input.snapshotCount} camera snapshot(s) saved for review.`);
  if (!input.hasRecording) notes.push("No audio recording was saved for this round.");
  for (const n of input.styleNotes.slice(0, 3)) notes.push(`Speaking style vs round 1: ${n}`);
  return { notes, snapshotCount: input.snapshotCount };
}

/** Averages of the per-question / per-skill / per-coding scores, using round 1's scoring code. */
export function scoreBreakdownOf(report: Pick<RoundTwoReport, "questions" | "criteriaEvaluations" | "codeEvaluations">): NonNullable<RoundTwoReport["scoreBreakdown"]> {
  const b = getSessionScoreBreakdown({
    questionEvaluations: report.questions.filter((q) => q.score > 0).map((q) => ({ question: q.question, score: q.score })),
    criteriaEvaluations: report.criteriaEvaluations ?? [],
    codeEvaluations: report.codeEvaluations ?? [],
  });
  return { questions: b.questions.avg, criteria: b.criteria.avg, coding: b.coding.avg };
}

/** Report written without a model call when there is nothing to evaluate. */
export function insufficientEvidenceReport(basis: RoundTwoReportBasis, extra: Pick<RoundTwoReport, "style" | "panel" | "integrity">): RoundTwoReport {
  return {
    summary: "Nothing could be evaluated for this round: no transcript, no tasks, no panel notes and no scorecards were captured. Add notes or scorecards and use Retry report to generate it again.",
    recommendation: "lean_no",
    confidence: 0,
    overallScore: 0,
    strengths: [],
    concerns: [],
    questions: [],
    round1Comparison: { consistency: "unknown", notes: [], contradictions: [] },
    insufficientEvidence: true,
    basis,
    scoreBreakdown: { questions: null, criteria: null, coding: null },
    ...extra,
    generatedAt: new Date().toISOString(),
  };
}
