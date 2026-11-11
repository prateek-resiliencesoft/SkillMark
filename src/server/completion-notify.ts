import "server-only";
import {
  normalizeNotifyPhone,
  parseCompletionNotifyMembers,
} from "@/lib/completion-notify";
import { createLogger } from "@/lib/logger";
import { sessionReportLink } from "./batch-access";
import type { Context } from "./context";
import { deliverCompletionWhatsapp, loadDeliveryConfig } from "./invite-delivery";

type Db = Context["supabase"];

const log = createLogger("completion-notify");

/**
 * WhatsApp team alert when a session becomes COMPLETED.
 * Idempotent via sessions.completionNotifiedAt (chat + voice race-safe).
 * Never throws — failures are logged only.
 */
export async function notifySessionCompleted(supabase: Db, sessionId: string): Promise<void> {
  try {
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from("sessions")
      .update({ completionNotifiedAt: claimedAt })
      .eq("id", sessionId)
      .is("completionNotifiedAt", null)
      .select("id, interviewId, participantName, candidateId")
      .maybeSingle();

    if (claimErr) {
      log.error("claim failed", claimErr.message);
      return;
    }
    if (!claimed?.interviewId) return;

    const { data: interview } = await supabase
      .from("interviews")
      .select("id, title, completionNotifyMembers, projectId, batchId")
      .eq("id", claimed.interviewId)
      .maybeSingle();
    if (!interview) return;

    let members = parseCompletionNotifyMembers(interview.completionNotifyMembers);

    if (!members.length && interview.batchId) {
      const { data: batch } = await supabase
        .from("interview_batches")
        .select("settings")
        .eq("id", interview.batchId)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settings = (batch?.settings ?? {}) as any;
      members = parseCompletionNotifyMembers(settings.completionNotifyMembers);
    }

    if (!members.length) return;

    let organizationId: string | null = null;
    if (interview.projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("organizationId")
        .eq("id", interview.projectId)
        .maybeSingle();
      organizationId = project?.organizationId ?? null;
    }
    if (!organizationId) {
      log.error("no organization for session", sessionId);
      return;
    }

    let candidateName =
      (claimed.participantName as string | null)?.trim() || "A candidate";
    if (claimed.candidateId) {
      const { data: cand } = await supabase
        .from("candidates")
        .select("name")
        .eq("id", claimed.candidateId)
        .maybeSingle();
      if (cand?.name) candidateName = cand.name;
    }

    const cfg = await loadDeliveryConfig(supabase, organizationId);
    if (!cfg.resilio) {
      log.info("skip completion WA — ResilioHub not configured", organizationId);
      return;
    }

    const interviewTitle = String(interview.title ?? "Interview").split(" · ")[0];
    const link = sessionReportLink(interview.id, sessionId);

    await Promise.all(
      members.map(async (m) => {
        const phone = normalizeNotifyPhone(m.phone);
        if (!phone) {
          log.info("skip member — bad phone", m.userId);
          return;
        }
        const r = await deliverCompletionWhatsapp(cfg, phone, {
          recipientName: m.name?.trim() || "there",
          candidateName,
          interviewTitle,
          organization: cfg.organizationName,
          link,
        });
        if (r.status !== "sent") {
          log.error("completion WA failed", m.userId, r.error);
        }
      }),
    );
  } catch (err) {
    log.error("notifySessionCompleted", err instanceof Error ? err.message : err);
  }
}
