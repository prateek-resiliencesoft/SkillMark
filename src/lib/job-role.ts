/** Short hiring-role label for session lists (Flutter Dev, HR, MERN, …). */

const ROLE_LINE = /(?:^|\n)\s*Role:\s*(.+?)(?:\n|$)/i;
const NOISE =
  /\b(interview|screening|assessment|round\s*\d+|technical\s*screen|phone\s*screen)\b/gi;

export type JobRoleSource = {
  jobRole?: string | null;
  title?: string | null;
  objective?: string | null;
};

export function parseJobRoleFromObjective(objective: string | null | undefined): string | null {
  if (!objective) return null;
  const m = objective.match(ROLE_LINE);
  const role = m?.[1]?.trim();
  return role ? role.slice(0, 80) : null;
}

export function jobRoleFromTitle(title: string | null | undefined): string | null {
  if (!title?.trim()) return null;
  // Drop " · CandidateName" / " - something" suffixes common on batch titles.
  let t = title.split(/[·•|]/)[0]?.trim() ?? title.trim();
  t = t.replace(NOISE, " ").replace(/\s+/g, " ").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();
  return t ? t.slice(0, 80) : null;
}

/** Prefer stored jobRole, then `Role:` in objective, then cleaned title. */
export function resolveJobRole(source: JobRoleSource): string | null {
  const stored = source.jobRole?.trim();
  if (stored) return stored.slice(0, 80);
  return parseJobRoleFromObjective(source.objective) ?? jobRoleFromTitle(source.title);
}
