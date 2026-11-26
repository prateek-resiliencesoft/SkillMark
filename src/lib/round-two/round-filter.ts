/** Round filter for /interviews + /candidates lists. "ALL" or round number 1..N */

export type RoundFilterValue = "ALL" | number;

export function deriveMaxRound(r2CandidateIds: readonly string[]): number {
  return r2CandidateIds.length > 0 ? 2 : 1;
}

export function clampRoundFilter(
  value: RoundFilterValue,
  maxRound: number,
): RoundFilterValue {
  if (value === "ALL") return "ALL";
  if (typeof value !== "number" || value < 1 || value > maxRound) return "ALL";
  return value;
}

export function candidateMatchesRound(
  row: { id: string; hasSession: boolean },
  filter: RoundFilterValue,
  r2CandidateIds: ReadonlySet<string>,
): boolean {
  if (filter === "ALL") return true;
  if (filter === 1) return row.hasSession;
  if (filter === 2) return r2CandidateIds.has(row.id);
  return false;
}

export function interviewMatchesRound(
  row: { id: string; sessionCount: number },
  filter: RoundFilterValue,
  r2InterviewIds: ReadonlySet<string>,
): boolean {
  if (filter === "ALL") return true;
  if (filter === 1) return row.sessionCount > 0;
  if (filter === 2) return r2InterviewIds.has(row.id);
  return false;
}
