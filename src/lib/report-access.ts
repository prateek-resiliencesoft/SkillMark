/**
 * Who may (re)generate a session report. Pure, unit-tested.
 *
 * Same scope as viewing the report (analysis.getSessionSummary): any non-VIEWER member of
 * the interview's organization with access to its project. Being the interview's creator
 * grants nothing on its own — removed or downgraded creators lose access like anyone else.
 */
export type ReportAccessInput = {
  userId: string;
  interviewOwnerId?: string | null;
  /** Caller's role in the interview's organization (null = not a member). */
  orgRole?: string | null;
  hasProjectAccess: boolean;
};

export type ReportAccess = { ok: true } | { ok: false; status: 403; error: string };

export function reportAccess(i: ReportAccessInput): ReportAccess {
  if (!i.orgRole) return { ok: false, status: 403, error: "You are not a member of this organization" };
  if (i.orgRole === "VIEWER") return { ok: false, status: 403, error: "Viewers can't generate reports" };
  if (!i.hasProjectAccess) return { ok: false, status: 403, error: "You do not have access to this project" };
  return { ok: true };
}
