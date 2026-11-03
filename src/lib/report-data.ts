/* eslint-disable @typescript-eslint/no-explicit-any */
import { countStrikes, MAX_STRIKES } from "@/lib/head-movement";
import { getSessionOverallScore } from "@/lib/session-score";

export type Recommendation = "hire" | "maybe" | "no";

export interface ReportQuestion {
  index: number;
  question: string;
  score: number;
  evaluation: string;
  highlights: string[];
  improvements: string[];
  answerExcerpt: string | null;
}

export interface ReportData {
  title: string;
  participantName: string;
  participantEmail: string | null;
  avatarUrl: string | null;
  status: string | null;
  createdAt: string | null;
  objective: string | null;
  durationMinutes: number | null;
  overallScore: number | null;
  recommendation: Recommendation | null;
  summary: string | null;
  criteria: { name: string; score: number; reasoning: string }[];
  questions: ReportQuestion[];
  questionsAnswered: number;
  strengths: string[];
  concerns: string[];
  keyInsights: string[];
  themes: string[];
  integrity: { label: string; count: number }[];
  integrityStrikes: number;
  maxStrikes: number;
  disqualified: boolean;
  transcript: { id: string; role: "USER" | "ASSISTANT" | string; content: string; timestamp: string }[];
}

const INTEGRITY_LABELS: Record<string, string> = {
  page_departure: "Page departure",
  tab_switch: "Page departure",
  focus_lost: "Page departure",
  paste: "External paste blocked",
  copy: "Copy attempt",
  cut: "Cut attempt",
  multi_screen: "Multi-screen detected",
  head_movement: "Head movement / looking away",
};

/** hire ≥ 7, maybe ≥ 5, else no. Disqualified sessions are always "no". */
export function recommendationFor(score: number | null, disqualified: boolean): Recommendation | null {
  if (disqualified) return "no";
  if (score === null) return null;
  if (score >= 7) return "hire";
  if (score >= 5) return "maybe";
  return "no";
}

/** Split long AI prose into short bullet points (sentences), capped. */
export function toBullets(text: string | null | undefined, max = 6): string[] {
  if (!text) return [];
  const lines = text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((s) => s.length > 2);
  return lines.slice(0, max);
}

function uniq(list: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Find the candidate's reply to a question in the transcript (best effort). */
export function findAnswerExcerpt(
  question: string,
  messages: { role: string; content: string }[],
  maxLen = 320,
): string | null {
  const key = norm(question).slice(0, 48);
  if (!key) return null;
  const words = key.split(" ").filter((w) => w.length > 3);
  let qIdx = messages.findIndex((m) => m.role !== "USER" && norm(m.content).includes(key));
  if (qIdx < 0 && words.length >= 3) {
    // Fallback: interviewer message sharing most of the question's words.
    let best = -1;
    let bestHits = 0;
    messages.forEach((m, i) => {
      if (m.role === "USER") return;
      const c = norm(m.content);
      const hits = words.filter((w) => c.includes(w)).length;
      if (hits > bestHits) {
        bestHits = hits;
        best = i;
      }
    });
    if (bestHits >= Math.ceil(words.length * 0.6)) qIdx = best;
  }
  if (qIdx < 0) return null;
  const parts: string[] = [];
  for (let i = qIdx + 1; i < messages.length && messages[i].role === "USER"; i++) parts.push(messages[i].content);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text;
}

/** Normalize the analysis.getSessionSummary payload for the report UI + PDF. */
export function buildReportData(d: any): ReportData {
  const insights = d?.insights;
  const obj = insights && !Array.isArray(insights) ? insights : {};
  const keyInsights: string[] = Array.isArray(insights) ? insights.map(String) : (obj.keyInsights ?? []).map(String);
  const criteria: { name: string; score: number; reasoning: string }[] = (obj.criteriaEvaluations ?? []).map((c: any) => ({
    name: String(c?.name ?? ""),
    score: Number(c?.score) || 0,
    reasoning: String(c?.reasoning ?? ""),
  }));
  const qes = (obj.questionEvaluations ?? []) as any[];
  const rawMessages = ((d?.messages ?? []) as any[]).filter(
    (m) => m.contentType !== "WHITEBOARD" && m.contentType !== "CODE",
  );
  const messages = rawMessages.map((m) => ({ role: String(m.role), content: String(m.content ?? "") }));
  const questions: ReportQuestion[] = qes.map((q, i) => ({
    index: i + 1,
    question: String(q?.question ?? ""),
    score: Number(q?.score) || 0,
    evaluation: String(q?.evaluation ?? ""),
    highlights: (q?.highlights ?? []).map(String),
    improvements: (q?.improvements ?? []).map(String),
    answerExcerpt: findAnswerExcerpt(String(q?.question ?? ""), messages),
  }));

  const overall = getSessionOverallScore({ questionEvaluations: qes as any, criteriaEvaluations: criteria });
  const log = (d?.antiCheatingLog ?? []) as { type: string }[];
  const counts = new Map<string, number>();
  for (const v of log) {
    const label = INTEGRITY_LABELS[v.type] ?? v.type;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const disqualified = d?.status === "DISQUALIFIED";
  const screenshots = (d?.screenshots ?? []) as { url: string; type: string }[];

  return {
    title: d?.interviewTitle ?? "Interview",
    participantName: d?.participantName || d?.participantEmail || "Anonymous",
    participantEmail: d?.participantEmail ?? null,
    avatarUrl: screenshots.find((s) => s.type === "camera")?.url ?? null,
    status: d?.status ?? null,
    createdAt: d?.createdAt ?? null,
    objective: d?.interviewObjective ?? null,
    durationMinutes: d?.totalDurationSeconds != null ? Math.max(1, Math.round(d.totalDurationSeconds / 60)) : null,
    overallScore: overall,
    recommendation: recommendationFor(overall, disqualified),
    summary: d?.summary ?? null,
    criteria,
    questions,
    questionsAnswered: questions.length || messages.filter((m) => m.role === "USER").length,
    strengths: uniq([...questions.flatMap((q) => q.highlights), ...criteria.filter((c) => c.score >= 7).map((c) => c.name)], 6),
    concerns: uniq([...questions.flatMap((q) => q.improvements), ...criteria.filter((c) => c.score < 5).map((c) => c.name)], 6),
    keyInsights,
    themes: (d?.themes ?? []).map(String),
    integrity: Array.from(counts, ([label, count]) => ({ label, count })),
    integrityStrikes: countStrikes(log),
    maxStrikes: MAX_STRIKES,
    disqualified,
    transcript: rawMessages.map((m) => ({
      id: String(m.id),
      role: String(m.role),
      content: String(m.content ?? ""),
      timestamp: String(m.timestamp ?? ""),
    })),
  };
}

/** Tailwind-free colour scale used by both the UI and the PDF. */
export function scoreColor(score: number): string {
  if (score >= 7) return "#16a34a";
  if (score >= 5) return "#d97706";
  return "#dc2626";
}
