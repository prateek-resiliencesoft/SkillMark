import { normalizeMatchText, textsOverlap } from "@/lib/question-conditions";
import { isIntroQuestion } from "@/lib/question-order";

type ScoreEntry =
  | { score?: number | string | null; excludeFromScore?: boolean; question?: string }
  | null
  | undefined;

export type SessionScoreInsights =
  | {
      questionEvaluations?: ScoreEntry[] | null;
      criteriaEvaluations?: ScoreEntry[] | null;
      codeEvaluations?: ScoreEntry[] | null;
    }
  | null
  | undefined;

export type NamedScore = { label: string; score: number };

export type ScoreGroup = {
  avg: number | null;
  items: NamedScore[];
};

export type SessionScoreBreakdown = {
  overall: number | null;
  /** Which list drove the overall average. */
  source: "questions" | "criteria" | null;
  questions: ScoreGroup;
  criteria: ScoreGroup;
  coding: ScoreGroup;
};

function toFiniteScore(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isScoreableEntry(entry: ScoreEntry): entry is NonNullable<ScoreEntry> {
  if (!entry || typeof entry !== "object") return false;
  if (entry.excludeFromScore === true) return false;
  return toFiniteScore(entry.score) !== null;
}

function averageScore(entries: ScoreEntry[] | null | undefined): number | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const scores = entries
    .filter(isScoreableEntry)
    .map((entry) => toFiniteScore(entry.score))
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function namedFrom(
  entries: unknown,
  labelOf: (entry: Record<string, unknown>, index: number) => string,
): ScoreGroup {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { avg: null, items: [] };
  }
  const items: NamedScore[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.excludeFromScore === true) continue;
    const score = toFiniteScore(row.score);
    if (score === null) continue;
    const label = labelOf(row, i).trim() || `Item ${i + 1}`;
    items.push({ label, score });
  }
  if (items.length === 0) return { avg: null, items: [] };
  const avg = items.reduce((sum, item) => sum + item.score, 0) / items.length;
  return { avg, items };
}

/** Mark screening/HR (etc.) evals so overall avg only uses technical + genuine Qs. */
export function applyQuestionScoreExclusions<
  T extends { question?: string; excludeFromScore?: boolean },
>(
  evaluations: T[] | null | undefined,
  excludedTexts: string[],
): Array<T & { excludeFromScore?: boolean }> {
  if (!Array.isArray(evaluations) || evaluations.length === 0) return evaluations ?? [];
  const needles = excludedTexts.map((t) => t.trim()).filter(Boolean);

  return evaluations.map((entry) => {
    const q = typeof entry.question === "string" ? entry.question : "";
    if (!q.trim()) return entry;
    const hit =
      isIntroQuestion(q) ||
      needles.some(
        (needle) =>
          normalizeMatchText(q) === normalizeMatchText(needle) || textsOverlap(q, needle),
      );
    if (!hit) return entry;
    return { ...entry, score: null, excludeFromScore: true as const };
  });
}

function asInsights(raw: unknown): SessionScoreInsights {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as SessionScoreInsights;
}

function hasUnscoredQuestionEvaluations(insights: SessionScoreInsights): boolean {
  return Array.isArray(insights?.questionEvaluations) && insights.questionEvaluations.length > 0;
}

export function getSessionOverallScore(
  insights: SessionScoreInsights,
): number | null {
  const questionScore = averageScore(insights?.questionEvaluations);
  if (questionScore !== null) return questionScore;
  // When questionEvaluations exists (e.g. only preset/bank Qs, zero AI Qs), don't leak criteria marks as overall.
  if (hasUnscoredQuestionEvaluations(insights)) return null;
  return averageScore(insights?.criteriaEvaluations);
}

export function usesQuestionEvaluationScore(
  insights: SessionScoreInsights,
): boolean {
  return averageScore(insights?.questionEvaluations) !== null;
}

/** Overall + per-bucket averages and named rows (questions / skills / coding). */
export function getSessionScoreBreakdown(raw: unknown): SessionScoreBreakdown {
  const insights = asInsights(raw);
  const questions = namedFrom(insights?.questionEvaluations, (entry, i) => {
    const q = typeof entry.question === "string" ? entry.question : "";
    return q ? `Q${i + 1}. ${q}` : `Question ${i + 1}`;
  });
  const criteria = namedFrom(insights?.criteriaEvaluations, (entry, i) => {
    const name = typeof entry.name === "string" ? entry.name : "";
    return name || `Skill ${i + 1}`;
  });
  const coding = namedFrom(insights?.codeEvaluations, (entry, i) => {
    const label =
      (typeof entry.snippetLabel === "string" && entry.snippetLabel) ||
      (typeof entry.question === "string" && entry.question) ||
      (typeof entry.language === "string" && `${entry.language} snippet`) ||
      "";
    return label || `Coding ${i + 1}`;
  });

  const questionAvg = averageScore(insights?.questionEvaluations);
  const criteriaAvg = averageScore(insights?.criteriaEvaluations);
  let overall: number | null = null;
  let source: SessionScoreBreakdown["source"] = null;
  if (questionAvg !== null) {
    overall = questionAvg;
    source = "questions";
  } else if (!hasUnscoredQuestionEvaluations(insights) && criteriaAvg !== null) {
    overall = criteriaAvg;
    source = "criteria";
  }

  return {
    overall,
    source,
    questions: { avg: questions.avg, items: questions.items },
    criteria: { avg: criteria.avg, items: criteria.items },
    coding: { avg: coding.avg, items: coding.items },
  };
}
