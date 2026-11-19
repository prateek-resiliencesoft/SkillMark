import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { sendResilioTemplate } from "@/lib/messaging/providers";
import { followupBodyVariables, normalizeWhatsappPhone, WHATSAPP_FOLLOWUP_META_TEMPLATE } from "@/lib/messaging/templates";
import { inviteLink } from "./batch-access";
import { loadDeliveryConfig } from "./invite-delivery";
import { claimFollowup, releaseFollowup } from "./followup-claim";

const log = createLogger("left-interview-followup");

/**
 * WhatsApp follow-up when a candidate leaves a live interview (session → ABANDONED).
 * Called on each ABANDONED transition; sent at most once per candidate per invite
 * link (atomic claim on candidates.followupSentToken, migration 37). Skipped (logged) when:
 *  - the project has no valid contact number (the template needs it),
 *  - the candidate has no valid phone (normalised to E.164),
 *  - the invite link has no expiry or already expired,
 *  - ResilioHub WhatsApp is not configured,
 *  - already sent for this invite, or migration 37 is missing.
 * A failed send releases the claim so it can retry. Never throws.
 */
export async function notifyCandidateLeftInterview(sessionId: string): Promise<void> {
  try {
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, candidateId, interviewId")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session?.candidateId || !session.interviewId) return;

    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("projectId")
      .eq("id", session.interviewId)
      .maybeSingle();
    if (!interview?.projectId) return;

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("organizationId, supportPhone")
      .eq("id", interview.projectId)
      .maybeSingle();
    const supportPhone = normalizeWhatsappPhone(project?.supportPhone);
    if (!project?.organizationId || !supportPhone) {
      log.info("skip — project has no contact number", sessionId);
      return;
    }

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, inviteToken, expiresAt")
      .eq("id", session.candidateId)
      .maybeSingle();
    const phone = normalizeWhatsappPhone(candidate?.phone);
    if (!candidate?.inviteToken || !phone) {
      log.info("skip — candidate has no valid WhatsApp number", sessionId);
      return;
    }
    const expiresAt = candidate.expiresAt ? String(candidate.expiresAt) : "";
    const expiryMs = Date.parse(expiresAt);
    if (!expiresAt || Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      log.info("skip — invite link has no future expiry", sessionId);
      return;
    }

    const cfg = await loadDeliveryConfig(supabaseAdmin, String(project.organizationId));
    if (!cfg.resilio) {
      log.info("skip — ResilioHub WhatsApp not configured", sessionId);
      return;
    }

    const claim = await claimFollowup(supabaseAdmin, String(session.candidateId), candidate.inviteToken);
    if (claim === "already-sent") {
      log.info("skip — follow-up already sent for this invite", sessionId);
      return;
    }
    if (claim !== "claimed") {
      log.error(
        claim === "unsupported"
          ? "skip — candidates.followupSentAt/followupSentToken missing; apply db/init/37-followup-sent.sql"
          : "skip — could not claim follow-up",
        sessionId,
      );
      return;
    }

    let ok = false;
    try {
      const r = await sendResilioTemplate({
        apiKey: cfg.resilio.apiKey,
        baseUrl: cfg.resilio.baseUrl,
        to: phone,
        templateName: WHATSAPP_FOLLOWUP_META_TEMPLATE.name,
        bodyVariables: followupBodyVariables({
          name: String(candidate.name ?? ""),
          supportPhone,
          link: inviteLink(candidate.inviteToken),
          expiresAt,
          organization: cfg.organizationName,
        }),
      });
      ok = r.ok;
      if (!r.ok) log.error("left-interview follow-up failed", sessionId, r.error);
    } finally {
      if (!ok) await releaseFollowup(supabaseAdmin, String(session.candidateId), candidate.inviteToken).catch(() => undefined);
    }
  } catch (err) {
    log.error("notifyCandidateLeftInterview", err instanceof Error ? err.message : err);
  }
}
