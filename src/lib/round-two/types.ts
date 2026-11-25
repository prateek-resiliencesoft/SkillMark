/** Round 2 live interview: shared (client + server) types and pure helpers. */

export const ROUND_TWO_STATUSES = ["draft", "scheduled", "live", "ended", "cancelled", "no_show"] as const;
export type RoundTwoStatus = (typeof ROUND_TWO_STATUSES)[number];

export const ROUND_TWO_REPORT_STATUSES = ["none", "pending", "generating", "ready", "failed"] as const;
export type RoundTwoReportStatus = (typeof ROUND_TWO_REPORT_STATUSES)[number];

export const PANEL_ROLES = ["host", "interviewer", "observer"] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

export const RECOMMENDATIONS = ["strong_no", "no", "lean_no", "lean_yes", "yes", "strong_yes"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_no: "Strong no",
  no: "No",
  lean_no: "Lean no",
  lean_yes: "Lean yes",
  yes: "Yes",
  strong_yes: "Strong yes",
};

export const QUESTION_CATEGORIES = ["technical", "behavioral", "probe_round1", "cv_claim", "culture", "other"] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export interface QuestionPlanItem {
  id: string;
  text: string;
  category: QuestionCategory;
  /** Why this question is worth asking (e.g. weak round 1 answer). */
  rationale?: string;
  followUps?: string[];
  /** Suggested time budget in minutes. */
  minutes?: number;
}

export interface Round1Claim {
  claim: string;
  /** Short quote from round 1 backing the claim. */
  evidence?: string;
}

export interface Round1Context {
  interviewTitle?: string;
  objective?: string;
  overallScore?: number | null;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  claims?: Round1Claim[];
  /** Candidate answers from round 1, trimmed; used for style comparison. */
  candidateAnswers?: string[];
  skills?: string[];
  resumeMarkdown?: string;
  /** Verbatim CV claims (grounded extraction), cached after the first plan run. */
  cvClaims?: GroundedClaim[];
}

/** A claim copied verbatim from a source, with offsets into it. */
export interface GroundedClaim {
  class: string;
  text: string;
  attributes?: Record<string, string>;
  start?: number;
  end?: number;
}

export const SUGGESTION_TYPES = ["follow_up", "cross_check", "new_topic", "clarify"] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

export interface CopilotSuggestion {
  type: SuggestionType;
  question: string;
  reason: string;
  /** Plan item this relates to, if any. */
  planId?: string;
}

export const FLAG_KINDS = ["contradiction", "vague", "possible_assistance", "red_flag", "strength"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export interface CopilotFlag {
  kind: FlagKind;
  detail: string;
  /** Quote from this round. */
  quote?: string;
  /** Matching round 1 claim / quote for contradictions. */
  round1Quote?: string;
  /** Quote found in the live transcript (false: model quote could not be located). */
  verified?: boolean;
}

export interface CopilotResult {
  suggestions: CopilotSuggestion[];
  coveredQuestionIds: string[];
  liveSummary: string;
  flags: CopilotFlag[];
}

export interface StyleMetrics {
  words: number;
  answers: number;
  avgWordsPerAnswer: number;
  /** Words per minute while speaking (only when timings are available). */
  wordsPerMinute: number | null;
  fillerRatio: number;
  /** Distinct words / total words. */
  lexicalDiversity: number;
}

export interface TranscriptSegment {
  speakerRole: "candidate" | "interviewer";
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface RoundTwoReport {
  summary: string;
  recommendation: Recommendation;
  confidence: number;
  overallScore: number;
  strengths: string[];
  concerns: string[];
  questions: { question: string; answerSummary: string; score: number; evidence?: string; evidenceVerified?: boolean }[];
  round1Comparison: {
    consistency: "consistent" | "mixed" | "inconsistent" | "unknown";
    notes: string[];
    contradictions: { round1: string; round2: string }[];
  };
  style: { round1: StyleMetrics | null; round2: StyleMetrics | null; notes: string[] };
  panel: { name: string; recommendation: Recommendation | null; comments: string }[];
  /** Quotes in the report checked against the transcript. */
  evidenceCheck?: { verified: number; unverified: number };
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  LiveKit identities                                                 */
/* ------------------------------------------------------------------ */

export const CANDIDATE_IDENTITY_PREFIX = "cand:";
export const USER_IDENTITY_PREFIX = "user:";
export const AGENT_IDENTITY_PREFIX = "agent:";

export const candidateIdentity = (roundTwoId: string) => `${CANDIDATE_IDENTITY_PREFIX}${roundTwoId}`;
export const userIdentity = (userId: string) => `${USER_IDENTITY_PREFIX}${userId}`;
export const agentIdentity = (roundTwoId: string) => `${AGENT_IDENTITY_PREFIX}${roundTwoId}`;

export function speakerRoleForIdentity(identity: string): "candidate" | "interviewer" | null {
  if (identity.startsWith(CANDIDATE_IDENTITY_PREFIX)) return "candidate";
  if (identity.startsWith(USER_IDENTITY_PREFIX)) return "interviewer";
  return null;
}

/** Data-channel topics the app publishes to interviewers. */
export const DATA_TOPICS = { transcript: "r2.transcript", copilot: "r2.copilot", admit: "r2.admit" } as const;

/* ------------------------------------------------------------------ */
/*  Style metrics                                                      */
/* ------------------------------------------------------------------ */

const FILLERS = new Set(["um", "uh", "erm", "hmm", "like", "basically", "actually", "literally", "so", "yeah"]);
const FILLER_PHRASES = ["you know", "i mean", "kind of", "sort of"];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Speaking-style signals from candidate answers. Signals, not verdicts. */
export function computeStyleMetrics(answers: (string | TranscriptSegment)[]): StyleMetrics | null {
  const segs = answers
    .map((a) => (typeof a === "string" ? { text: a } : a))
    .filter((a) => a.text.trim().length > 0) as { text: string; startMs?: number; endMs?: number }[];
  if (segs.length === 0) return null;
  let total = 0;
  let fillers = 0;
  let spokenMs = 0;
  let timedWords = 0;
  const distinct = new Set<string>();
  for (const s of segs) {
    const w = words(s.text);
    total += w.length;
    for (const t of w) {
      distinct.add(t);
      if (FILLERS.has(t)) fillers++;
    }
    const lower = ` ${s.text.toLowerCase()} `;
    for (const p of FILLER_PHRASES) fillers += lower.split(` ${p} `).length - 1;
    if (typeof s.startMs === "number" && typeof s.endMs === "number" && s.endMs > s.startMs) {
      spokenMs += s.endMs - s.startMs;
      timedWords += w.length;
    }
  }
  if (total === 0) return null;
  const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    words: total,
    answers: segs.length,
    avgWordsPerAnswer: round(total / segs.length, 1),
    wordsPerMinute: spokenMs >= 5_000 ? Math.round(timedWords / (spokenMs / 60_000)) : null,
    fillerRatio: round(fillers / total, 3),
    lexicalDiversity: round(distinct.size / total, 3),
  };
}

/** Human-readable differences between two style profiles (only notable gaps). */
export function compareStyle(a: StyleMetrics | null, b: StyleMetrics | null): string[] {
  if (!a || !b) return [];
  const notes: string[] = [];
  const pct = (x: number, y: number) => (y === 0 ? 0 : (x - y) / y);
  const len = pct(b.avgWordsPerAnswer, a.avgWordsPerAnswer);
  if (Math.abs(len) >= 0.5) {
    notes.push(`Answers are ${len > 0 ? "much longer" : "much shorter"} than round 1 (${a.avgWordsPerAnswer} vs ${b.avgWordsPerAnswer} words per answer).`);
  }
  if (Math.abs(b.fillerRatio - a.fillerRatio) >= 0.03) {
    notes.push(`Filler-word rate changed from ${(a.fillerRatio * 100).toFixed(1)}% to ${(b.fillerRatio * 100).toFixed(1)}%.`);
  }
  if (Math.abs(b.lexicalDiversity - a.lexicalDiversity) >= 0.15) {
    notes.push(`Vocabulary variety changed noticeably (${a.lexicalDiversity} vs ${b.lexicalDiversity}).`);
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/*  Parsing helpers for LLM output                                     */
/* ------------------------------------------------------------------ */

function str(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function normalizePlan(raw: unknown, idPrefix = "q"): QuestionPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionPlanItem[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const text = str(o.text ?? o.question, 1000);
    if (!text) return;
    let id = str(o.id, 40) || `${idPrefix}${i + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const minutes = Number(o.minutes);
    out.push({
      id,
      text,
      category: pick(o.category, QUESTION_CATEGORIES, "other"),
      rationale: str(o.rationale, 500) || undefined,
      followUps: Array.isArray(o.followUps)
        ? o.followUps.map((f) => str(f, 500)).filter(Boolean).slice(0, 5)
        : undefined,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(60, Math.round(minutes)) : undefined,
    });
  });
  return out.slice(0, 40);
}

export function normalizeCopilot(raw: unknown, planIds: string[]): CopilotResult {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = new Set(planIds);
  const suggestions = Array.isArray(o.suggestions)
    ? o.suggestions
        .map((s) => {
          const r = (s ?? {}) as Record<string, unknown>;
          const question = str(r.question, 600);
          if (!question) return null;
          const planId = str(r.planId, 40);
          return {
            type: pick(r.type, SUGGESTION_TYPES, "follow_up"),
            question,
            reason: str(r.reason, 400),
            planId: ids.has(planId) ? planId : undefined,
          } satisfies CopilotSuggestion;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .slice(0, 6)
    : [];
  const flags = Array.isArray(o.flags)
    ? o.flags
        .map((f) => {
          const r = (f ?? {}) as Record<string, unknown>;
          const detail = str(r.detail, 500);
          if (!detail) return null;
          return {
            kind: pick(r.kind, FLAG_KINDS, "vague"),
            detail,
            quote: str(r.quote, 400) || undefined,
            round1Quote: str(r.round1Quote, 400) || undefined,
          } satisfies CopilotFlag;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .slice(0, 6)
    : [];
  const covered = Array.isArray(o.coveredQuestionIds)
    ? o.coveredQuestionIds.map((x) => str(x, 40)).filter((x) => ids.has(x))
    : [];
  return { suggestions, flags, coveredQuestionIds: covered, liveSummary: str(o.liveSummary, 4000) };
}
