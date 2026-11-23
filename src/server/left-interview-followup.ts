import "server-only";
import { createLogger } from "@/lib/logger";
import { sendBrevoEmail, sendResendEmail, sendResilioTemplate } from "@/lib/messaging/providers";
import {
  FOLLOWUP_EMAIL_SUBJECT,
  FOLLOWUP_EXTEND_MS,
  WHATSAPP_FOLLOWUP_META_TEMPLATE,
  followupBodyVariables,
  followupEmailHtml,
  normalizeWhatsappPhone,
  renderFollowupEmailText,
  type FollowupTemplateVars,
} from "@/lib/messaging/templates";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviteLink } from "./batch-access";
import { setCandidateDecisionStatus } from "./candidate-decision";
import { claimFollowup, releaseFollowup } from "./followup-claim";
import { loadDeliveryConfig } from "./invite-delivery";

const log = createLogger("left-interview-followup");

export type LeftFollowupResult = {
  status: "sent" | "failed" | "skipped";
  error?: string;
  email?: "sent" | "failed" | "skipped";
  whatsapp?: "sent" | "failed" | "skipped";
};

async function recordFollowupError(candidateId: string, message: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from("candidates")
    .update({ followupError: message ? message.slice(0, 500) : null })
    .eq("id", candidateId);
  if (error && !/followupError|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
    log.error("could not record follow-up error", candidateId, error.message);
  }
}

async function sendFollowupEmail(
  organizationId: string,
  to: string | null | undefined,
  name: string,
  vars: FollowupTemplateVars,
): Promise<"sent" | "failed" | "skipped"> {
  if (!to?.trim()) return "skipped";
  const cfg = await loadDeliveryConfig(supabaseAdmin, organizationId);
  const provider =
    cfg.defaultEmailProvider || (cfg.brevo && !cfg.resend ? "brevo" : "resend");
  const subject = FOLLOWUP_EMAIL_SUBJECT;
  const text = renderFollowupEmailText(vars);
  const html = followupEmailHtml(vars);

  if (provider === "brevo") {
    if (!cfg.brevo) return "failed";
    const r = await sendBrevoEmail({
      apiKey: cfg.brevo.apiKey,
      fromEmail: cfg.brevo.fromEmail,
      fromName: "RESILIENCESOFT",
      toEmail: to,
      toName: name,
      replyTo: cfg.brevo.replyTo,
      subject,
      html,
      text,
    });
    return r.ok ? "sent" : "failed";
  }
  if (!cfg.resend) return "failed";
  const r = await sendResendEmail({
    apiKey: cfg.resend.apiKey,
    from: cfg.resend.from,
    replyTo: cfg.resend.replyTo,
    to,
    subject,
    text,
    html,
  });
  return r.ok ? "sent" : "failed";
}

/**
 * Incomplete-interview follow-up (`interview_incomplete_reminder`).
 * Manual from dashboard always; auto only when interviews.autoLeftFollowup
 * (see notifyCandidateLeftInterview). WhatsApp primary; email additive.
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
      .select("projectId, title, autoLeftFollowup")
      .eq("id", session.interviewId)
      .maybeSingle();
    if (!interview?.projectId) return skip("This interview has no project.");

    if (!opts.manual && !interview.autoLeftFollowup) {
      // Default-off: silent skip so the dashboard does not show a false follow-up error.
      log.info("skip — autoLeftFollowup off", sessionId);
      return { status: "skipped" };
    }

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
      .select("name, email, phone, inviteToken, expiresAt")
      .eq("id", candidateId)
      .maybeSingle();
    const phone = normalizeWhatsappPhone(candidate?.phone);
    if (!candidate?.inviteToken || !phone) {
      return skip("The candidate has no valid WhatsApp number. Add one with a country code, e.g. +91…");
    }

    // Always use a live future deadline in {{4}}. Missing/past → extend 7 days and persist.
    let expiresAt = candidate.expiresAt ? String(candidate.expiresAt) : "";
    let expiryMs = Date.parse(expiresAt);
    if (!expiresAt || Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      const next = new Date(Date.now() + FOLLOWUP_EXTEND_MS);
      expiresAt = next.toISOString();
      expiryMs = next.getTime();
      const { error: expErr } = await supabaseAdmin
        .from("candidates")
        .update({ expiresAt, updatedAt: new Date().toISOString() })
        .eq("id", candidateId);
      if (expErr) {
        return skip("Could not set a link expiry date for the follow-up message. Extend expiry and try again.");
      }
      log.info("extended candidate expiresAt for follow-up", candidateId, expiresAt);
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

    const title = String(interview.title ?? "Interview").split(" · ")[0] || "Interview";
    const vars: FollowupTemplateVars = {
      name: String(candidate.name ?? ""),
      supportPhone,
      link: inviteLink(candidate.inviteToken),
      expiresAt,
      position: title,
    };

    let waOk = false;
    let sendError: string | undefined;
    let emailStatus: "sent" | "failed" | "skipped" = "skipped";
    try {
      const r = await sendResilioTemplate({
        apiKey: cfg.resilio.apiKey,
        baseUrl: cfg.resilio.baseUrl,
        to: phone,
        templateName: WHATSAPP_FOLLOWUP_META_TEMPLATE.name,
        bodyVariables: followupBodyVariables(vars),
      });
      waOk = r.ok;
      sendError = r.error;
      if (!r.ok) log.error("left-interview follow-up failed", sessionId, r.error);

      emailStatus = await sendFollowupEmail(
        String(project.organizationId),
        candidate.email,
        String(candidate.name ?? ""),
        vars,
      );
    } catch (err) {
      sendError = err instanceof Error ? err.message : "WhatsApp send failed.";
      log.error("left-interview follow-up threw", sessionId, sendError);
    } finally {
      if (!waOk) await releaseFollowup(supabaseAdmin, candidateId, candidate.inviteToken).catch(() => undefined);
    }

    if (waOk) {
      await recordFollowupError(candidateId, null);
      await setCandidateDecisionStatus(supabaseAdmin, candidateId, "followup_sent");
      return { status: "sent", whatsapp: "sent", email: emailStatus };
    }
    const error = sendError ?? "WhatsApp send failed.";
    await recordFollowupError(candidateId, error);
    return { status: "failed", error, whatsapp: "failed", email: emailStatus };
  } catch (err) {
    log.error("sendLeftInterviewFollowup", err instanceof Error ? err.message : err);
    return { status: "failed", error: err instanceof Error ? err.message : "Follow-up failed." };
  }
}

/** Automatic send when session → ABANDONED; no-op unless interviews.autoLeftFollowup. */
export async function notifyCandidateLeftInterview(sessionId: string): Promise<void> {
  await sendLeftInterviewFollowup(sessionId, { manual: false });
}
