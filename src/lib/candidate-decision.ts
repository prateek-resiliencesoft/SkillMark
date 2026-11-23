/** Recruiter outcome on a candidate after media review or incomplete follow-up. */
export const CANDIDATE_DECISION_STATUSES = [
  "none",
  "approved",
  "rejected",
  "followup_sent",
] as const;

export type CandidateDecisionStatus = (typeof CANDIDATE_DECISION_STATUSES)[number];

export function decisionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "followup_sent":
      return "Follow-up sent";
    default:
      return "";
  }
}
