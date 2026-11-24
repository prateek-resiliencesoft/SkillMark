/** Shared constants + types for AI bug triage. */

export const TRIAGE_SOURCES = ["feedback", "error_log"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

export const TRIAGE_STATUSES = ["pending", "processing", "done", "failed", "skipped"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const BUG_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const ERRORISH: ReadonlySet<BugSeverity> = new Set(["error", "critical"]);
export const NOISEISH: ReadonlySet<BugSeverity> = new Set(["info", "warning"]);

export const DEFAULT_TRIAGE_SETTINGS = {
  enabled: true,
  errorThreshold: 10,
  noiseThreshold: 50,
  windowDays: 7,
} as const;

export type BugTriageSettings = {
  enabled: boolean;
  errorThreshold: number;
  noiseThreshold: number;
  windowDays: number;
  updatedAt?: string;
};

export type BugBucketRow = {
  id: string;
  bugKey: string;
  title: string;
  severity: BugSeverity;
  summary: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  lastCommentedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TriageEventPayload = {
  message?: string | null;
  rating?: number | null;
  tags?: string[];
  category?: string | null;
  severityHint?: string | null;
  sourceLabel?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  candidateName?: string | null;
};

/** Normalize AI bugKey into a stable slug. */
export function normalizeBugKey(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "unspecified-bug";
}

/** Should this severity + window count open/update a GitHub issue? */
export function shouldRaiseGithubIssue(
  severity: BugSeverity,
  countInWindow: number,
  settings: Pick<BugTriageSettings, "errorThreshold" | "noiseThreshold">,
): boolean {
  if (ERRORISH.has(severity)) return countInWindow >= settings.errorThreshold;
  if (NOISEISH.has(severity)) return countInWindow >= settings.noiseThreshold;
  return false;
}

export function isBugSeverity(v: unknown): v is BugSeverity {
  return typeof v === "string" && (BUG_SEVERITIES as readonly string[]).includes(v);
}
