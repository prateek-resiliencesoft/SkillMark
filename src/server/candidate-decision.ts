import "server-only";
import type { CandidateDecisionStatus } from "@/lib/candidate-decision";
import { createLogger } from "@/lib/logger";
import type { Context } from "./context";

type Db = Context["supabase"];
const log = createLogger("candidate-decision");

/**
 * Persist recruiter decision on the candidate.
 * `followup_sent` only writes when current status is still `none` (approve/reject win).
 */
export async function setCandidateDecisionStatus(
  supabase: Db,
  candidateId: string,
  status: Exclude<CandidateDecisionStatus, "none">,
): Promise<void> {
  try {
    if (status === "followup_sent") {
      const { error } = await supabase
        .from("candidates")
        .update({ decisionStatus: "followup_sent" })
        .eq("id", candidateId)
        .eq("decisionStatus", "none");
      if (error && !/decisionStatus|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
        log.error("followup_sent update failed", candidateId, error.message);
      }
      return;
    }
    const { error } = await supabase
      .from("candidates")
      .update({ decisionStatus: status })
      .eq("id", candidateId);
    if (error && !/decisionStatus|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
      log.error("decisionStatus update failed", candidateId, error.message);
    }
  } catch (err) {
    log.error("setCandidateDecisionStatus", candidateId, err instanceof Error ? err.message : err);
  }
}
