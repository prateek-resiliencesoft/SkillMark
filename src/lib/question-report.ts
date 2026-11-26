/**
 * Question-by-question list of a session report.
 *
 * The AI summary only evaluates what it chooses to, so it often leaves out the
 * general / HR / question-bank questions (name, CTC, location, bond …). The
 * report must list every question that was asked, in the order the interview
 * runs them, with those unscored ones marked "Not scored" and no marks. This
 * merges the interview's saved questions with the AI's evaluations.
 * Pure: shared by the summary generator (persisted) and the report builder
 * (older sessions).
 */
import { normalizeMatchText, textsOverlap } from "@/lib/question-conditions";
import { isQuestionTextExcluded } from "@/lib/premade-sections";
import { applyQuestionScoreExclusions } from "@/lib/session-score";

export type PlannedQuestion = {
  text: string;
  order?: number | null;
  type?: string | null;
  description?: string | null;
  validationRules?: unknown;
};

type Msg = { role: string; content: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = Record<string, any>;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Index of the interviewer message that asked `question` (best effort), or -1. */
export function findQuestionMessageIndex(question: string, messages: Msg[]): number {
  const key = norm(question).slice(0, 48);
  if (!key) return -1;
  const words = key.split(" ").filter((w) => w.length > 3);
  let qIdx = messages.findIndex((m) => m.role.toUpperCase() !== "USER" && norm(m.content).includes(key));
  if (qIdx < 0 && words.length >= 3) {
    let best = -1;
    let bestHits = 0;
    messages.forEach((m, i) => {
      if (m.role.toUpperCase() === "USER") return;
      const c = norm(m.content);
      const hits = words.filter((w) => c.includes(w)).length;
      if (hits > bestHits) {
        bestHits = hits;
        best = i;
      }
    });
    if (bestHits >= Math.ceil(words.length * 0.6)) qIdx = best;
  }
  return qIdx;
}

function sameQuestion(a: string, b: string): boolean {
  return normalizeMatchText(a) === normalizeMatchText(b) || textsOverlap(a, b);
}

/**
 * Every question asked, in the interview's question order. Evaluations that
 * match no saved question (AI follow-ups) are kept after them. Preset / bank /
 * general questions are always "Not scored" with no marks; only AI-generated
 * questions keep their score.
 */
export function mergeQuestionEvaluations(args: {
  planned: PlannedQuestion[] | null | undefined;
  evaluations: Evaluation[] | null | undefined;
  /** Texts of preset / bank questions (see collectExcludedScoreTexts). */
  excludedTexts: string[];
  messages: Msg[];
}): Evaluation[] {
  const evals = Array.isArray(args.evaluations) ? args.evaluations.filter((e) => e && typeof e === "object") : [];
  const planned = (args.planned ?? [])
    .filter((q) => typeof q?.text === "string" && q.text.trim())
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (planned.length === 0) return applyQuestionScoreExclusions(evals, args.excludedTexts);

  const used = new Set<number>();
  const rows = planned.map((q) => {
    let hit = evals.findIndex((e, i) => !used.has(i) && normalizeMatchText(String(e.question ?? "")) === normalizeMatchText(q.text));
    if (hit < 0) hit = evals.findIndex((e, i) => !used.has(i) && sameQuestion(String(e.question ?? ""), q.text));
    if (hit >= 0) used.add(hit);
    const excluded = isQuestionTextExcluded(q.text, args.excludedTexts, q);
    const asked = findQuestionMessageIndex(q.text, args.messages) >= 0;
    return { q, ev: hit >= 0 ? evals[hit] : null, excluded, asked };
  });

  // Questions after the last one that was reached were never asked: leave them out.
  let lastReached = -1;
  rows.forEach((r, i) => {
    if (r.ev || r.asked) lastReached = i;
  });

  const out: Evaluation[] = [];
  rows.forEach((r, i) => {
    if (r.ev) {
      out.push(
        r.excluded
          ? { ...r.ev, question: r.ev.question || r.q.text, score: null, excludeFromScore: true }
          : { ...r.ev, question: r.ev.question || r.q.text },
      );
      return;
    }
    // Preset / general questions skipped mid-interview still show; AI questions only when actually asked.
    if (!(r.excluded ? i <= lastReached : r.asked)) return;
    out.push({
      question: r.q.text,
      score: null,
      ...(r.excluded ? { excludeFromScore: true } : {}),
      evaluation: "",
      highlights: [],
      improvements: [],
    });
  });
  const extra = evals.filter((_, i) => !used.has(i));
  return [...out, ...applyQuestionScoreExclusions(extra, args.excludedTexts)];
}
