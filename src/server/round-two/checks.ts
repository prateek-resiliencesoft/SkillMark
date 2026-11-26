/** Pure, deterministic checks the round 2 graphs run on model output (no I/O, safe to unit test). */
import { alignSpan, wordOverlap } from "@/lib/ai/extract/align";
import type { CopilotFlag, GroundedClaim, LiveScoring, QuestionPlanItem, Round1Context, RoundTwoReport } from "@/lib/round-two/types";

/** Overlap above which a plan question is taken to address a weakness / claim. */
const ADDRESSED = 0.12;
/** Claim pairs at or above this word overlap are worth cross-checking. */
const RELATED = 0.18;

export interface ClaimPair {
  claim: string;
  related: string;
  source: "round 1" | "CV" | "earlier in round 2";
}

function addressed(target: string, plan: QuestionPlanItem[]): boolean {
  return plan.some((q) => wordOverlap(target, [q.text, q.rationale ?? "", ...(q.followUps ?? [])].join(" ")) >= ADDRESSED);
}

/** Coverage check: round 1 weaknesses / claims and key CV claims nobody asks about, plus time fit. */
export function planGaps(plan: QuestionPlanItem[], ctx: Round1Context, cvClaims: GroundedClaim[], durationMin: number): string[] {
  const gaps: string[] = [];
  for (const w of (ctx.weaknesses ?? []).slice(0, 6)) if (!addressed(w, plan)) gaps.push(`Round 1 weakness not probed: ${w}`);
  for (const c of (ctx.claims ?? []).slice(0, 6)) if (!addressed(c.claim, plan)) gaps.push(`Round 1 claim not cross-checked: ${c.claim}`);
  const keyCv = cvClaims.filter((c) => c.class === "achievement" || c.class === "experience").slice(0, 6);
  const uncheckedCv = keyCv.filter((c) => !addressed(c.text, plan));
  if (keyCv.length && uncheckedCv.length > keyCv.length / 2) {
    for (const c of uncheckedCv.slice(0, 3)) gaps.push(`CV claim not verified: ${c.text}`);
  }
  const minutes = plan.reduce((n, q) => n + (q.minutes ?? 0), 0);
  if (minutes > durationMin * 1.2) gaps.push(`Plan needs ~${minutes} min but the interview is ${durationMin} min`);
  return gaps;
}

/** Earlier statements that relate to the new claims (round 1, CV, earlier round 2). */
export function relatedPairs(claims: GroundedClaim[], round1: Round1Context, prior: GroundedClaim[], max = 8): ClaimPair[] {
  const pool: { text: string; source: ClaimPair["source"] }[] = [
    ...(round1.claims ?? []).map((c) => ({ text: c.evidence ? `${c.claim} ("${c.evidence}")` : c.claim, source: "round 1" as const })),
    ...(round1.cvClaims ?? []).map((c) => ({ text: c.text, source: "CV" as const })),
    ...prior.map((c) => ({ text: c.text, source: "earlier in round 2" as const })),
  ];
  const out: (ClaimPair & { score: number })[] = [];
  for (const c of claims) {
    let best: { text: string; source: ClaimPair["source"]; score: number } | null = null;
    for (const p of pool) {
      if (p.text === c.text) continue;
      const score = wordOverlap(c.text, p.text);
      if (score >= RELATED && (!best || score > best.score)) best = { ...p, score };
    }
    if (best) out.push({ claim: c.text, related: best.text, source: best.source, score: best.score });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ claim, related, source }) => ({ claim, related, source }));
}

/** Mark flags whose quotes can be found verbatim (or nearly) in the sources. */
export function verifyFlags(flags: CopilotFlag[], transcript: string, round1Text: string): CopilotFlag[] {
  return flags.map((f) => {
    const q = f.quote ? alignSpan(transcript, f.quote) : null;
    const r1 = f.round1Quote ? alignSpan(round1Text, f.round1Quote) : null;
    const verified = (!f.quote || !!q) && (!f.round1Quote || !!r1);
    return {
      ...f,
      quote: q ? transcript.slice(q.start, q.end) : f.quote,
      round1Quote: r1 ? round1Text.slice(r1.start, r1.end) : f.round1Quote,
      verified,
    };
  });
}

/** Mark report evidence / contradiction quotes that can be located in the candidate's words. */
export function verifyReportEvidence(report: RoundTwoReport, candidateText: string): RoundTwoReport {
  let verified = 0;
  let unverified = 0;
  const tally = (ok: boolean) => {
    if (ok) verified++;
    else unverified++;
    return ok;
  };
  const questions = report.questions.map((q) => {
    if (!q.evidence) return q;
    const quotes = [...q.evidence.matchAll(/"([^"]{8,})"/g)].map((m) => m[1]);
    const targets = quotes.length ? quotes : [q.evidence];
    return { ...q, evidenceVerified: tally(targets.every((t) => !!alignSpan(candidateText, t))) };
  });
  for (const c of report.round1Comparison.contradictions) {
    if (c.round2) tally(!!alignSpan(candidateText, c.round2));
  }
  return { ...report, questions, evidenceCheck: { verified, unverified } };
}

/** Live scores: keep evidence only if it is in the candidate's words; unverified evidence can't carry a score. */
export function verifyLiveScoring(scoring: LiveScoring, candidateText: string): LiveScoring {
  return {
    ...scoring,
    scores: scoring.scores.map((c) => {
      if (!c.evidence) return { ...c, verified: false };
      const span = alignSpan(candidateText, c.evidence);
      return span ? { ...c, evidence: candidateText.slice(span.start, span.end), verified: true } : { ...c, verified: false };
    }),
  };
}
