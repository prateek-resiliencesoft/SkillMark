import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { sendResilioTemplate } from "@/lib/messaging/providers";
import { followupBodyVariables, WHATSAPP_FOLLOWUP_META_TEMPLATE } from "@/lib/messaging/templates";
import { inviteLink } from "./batch-access";
import { loadDeliveryConfig } from "./invite-delivery";

const log = createLogger("left-interview-followup");

/**
 * WhatsApp follow-up when a candidate leaves a live interview (session → ABANDONED).
 * Called once per ABANDONED transition. Skipped (logged) when:
 *  - the project has no contact number (the template needs it),
 *  - the candidate has no phone with a country code,
 *  - the invite link has no expiry or already expired,
 *  - ResilioHub WhatsApp is not configured.
 * Never throws.
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
    const supportPhone = String(project?.supportPhone ?? "").trim();
    if (!project?.organizationId || !supportPhone) {
      log.info("skip — project has no contact number", sessionId);
      return;
    }

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, inviteToken, expiresAt")
      .eq("id", session.candidateId)
      .maybeSingle();
    const phone = String(candidate?.phone ?? "").replace(/[\s()-]/g, "");
    if (!candidate?.inviteToken || !phone.startsWith("+")) {
      log.info("skip — candidate has no WhatsApp number with country code", sessionId);
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
    if (!r.ok) log.error("left-interview follow-up failed", sessionId, r.error);
  } catch (err) {
    log.error("notifyCandidateLeftInterview", err instanceof Error ? err.message : err);
  }
}
