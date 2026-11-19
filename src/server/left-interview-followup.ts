import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { sendResilioTemplate } from "@/lib/messaging/providers";
import { followupBodyVariables, normalizeWhatsappPhone, WHATSAPP_FOLLOWUP_META_TEMPLATE } from "@/lib/messaging/templates";
import { inviteLink } from "./batch-access";
import { loadDeliveryConfig } from "./invite-delivery";
import { claimFollowup, releaseFollowup } from "./followup-claim";

const log = createLogger("left-interview-followup");

export type LeftFollowupResult = { status: "sent" | "failed" | "skipped"; error?: string };

/**
 * Why the follow-up was not sent (null clears it), so the dashboard can explain it.
 * Best-effort: needs migration 38; without it the send/skip still behaves the same.
 */
async function recordFollowupError(candidateId: string, message: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from("candidates")
    .update({ followupError: message ? message.slice(0, 500) : null })
    .eq("id", candidateId);
  if (error && !/followupError|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
    log.error("could not record follow-up error", candidateId, error.message);
  }
}

/**
 * WhatsApp follow-up for a candidate who left a live interview (session → ABANDONED).
 * Runs automatically on each ABANDONED transition, and manually from the dashboard
 * (`manual: true`) for candidates it did not reach. Sent at most once per candidate per
 * invite link (atomic claim on candidates.followupSentToken, migration 37). Not sent when:
 *  - the project has no valid contact number (the template needs it),
 *  - the candidate has no valid phone (normalised to E.164),
 *  - the invite link has no expiry or already expired,
 *  - ResilioHub WhatsApp is not configured,
 *  - already sent for this invite, or migration 37 is missing.
 * The reason is saved on the candidate (followupError). A failed send releases the claim
 * so it can be retried. Never throws.
 */
export async function sendLeftInterviewFollowup(
  sessionId: string,
  opts: { manual?: boolean } = {},
): Promise<LeftFollowupResult> {
  try {
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status, candidateId, interviewId")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return { status: "skipped", error: "Session not found." };
    if (opts.manual && session.status !== "ABANDONED") {
      return { status: "skipped", error: "This candidate has not left the interview." };
    }
    if (!session.candidateId || !session.interviewId) {
      return { status: "skipped", error: "This session has no candidate to message." };
    }
    const candidateId = String(session.candidateId);

    const skip = async (error: string): Promise<LeftFollowupResult> => {
      log.info(`skip — ${error}`, sessionId);
      await recordFollowupError(candidateId, error);
      return { status: "skipped", error };
    };

    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("projectId")
      .eq("id", session.interviewId)
      .maybeSingle();
    if (!interview?.projectId) return skip("This interview has no project.");

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("organizationId, supportPhone")
      .eq("id", interview.projectId)
      .maybeSingle();
    const supportPhone = normalizeWhatsappPhone(project?.supportPhone);
    if (!project?.organizationId || !supportPhone) {
      return skip("Add a contact number in Project settings → General first.");
    }

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("name, phone, inviteToken, expiresAt")
      .eq("id", candidateId)
      .maybeSingle();
    const phone = normalizeWhatsappPhone(candidate?.phone);
    if (!candidate?.inviteToken || !phone) {
      return skip("The candidate has no valid WhatsApp number. Add one with a country code, e.g. +91…");
    }
    const expiresAt = candidate.expiresAt ? String(candidate.expiresAt) : "";
    const expiryMs = Date.parse(expiresAt);
    if (!expiresAt || Number.isNaN(expiryMs)) {
      return skip("The invite link has no expiry date, which the message needs.");
    }
    if (expiryMs <= Date.now()) {
      return skip("The invite link has already expired. Send a new link instead.");
    }

    const cfg = await loadDeliveryConfig(supabaseAdmin, String(project.organizationId));
    if (!cfg.resilio) {
      return skip("WhatsApp (ResilioHub) is not configured in Settings → Integrations.");
    }

    const claim = await claimFollowup(supabaseAdmin, candidateId, candidate.inviteToken);
    if (claim === "already-sent") {
      log.info("skip — follow-up already sent for this invite", sessionId);
      return { status: "skipped", error: "The follow-up was already sent for this link." };
    }
    if (claim !== "claimed") {
      log.error(
        claim === "unsupported"
          ? "skip — candidates.followupSentAt/followupSentToken missing; apply db/init/37-followup-sent.sql"
          : "skip — could not claim follow-up",
        sessionId,
      );
      return {
        status: "skipped",
        error:
          claim === "unsupported"
            ? "The database is missing migration 37 (followup-sent)."
            : "Could not reserve the send. Please try again.",
      };
    }

    let ok = false;
    let sendError: string | undefined;
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
      sendError = r.error;
      if (!r.ok) log.error("left-interview follow-up failed", sessionId, r.error);
    } catch (err) {
      sendError = err instanceof Error ? err.message : "WhatsApp send failed.";
      log.error("left-interview follow-up threw", sessionId, sendError);
    } finally {
      if (!ok) await releaseFollowup(supabaseAdmin, candidateId, candidate.inviteToken).catch(() => undefined);
    }

    if (ok) {
      await recordFollowupError(candidateId, null);
      return { status: "sent" };
    }
    const error = sendError ?? "WhatsApp send failed.";
    await recordFollowupError(candidateId, error);
    return { status: "failed", error };
  } catch (err) {
    log.error("sendLeftInterviewFollowup", err instanceof Error ? err.message : err);
    return { status: "failed", error: err instanceof Error ? err.message : "Follow-up failed." };
  }
}

/** Automatic send, fired when a live session becomes ABANDONED. Never throws. */
export async function notifyCandidateLeftInterview(sessionId: string): Promise<void> {
  await sendLeftInterviewFollowup(sessionId);
}
