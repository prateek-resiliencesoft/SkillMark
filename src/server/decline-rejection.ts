import "server-only";
import { createLogger } from "@/lib/logger";
import { sendBrevoEmail, sendResendEmail, sendResilioTemplate } from "@/lib/messaging/providers";
import {
  APPROVAL_EMAIL_SUBJECT,
  DECLINE_EMAIL_SUBJECT,
  WHATSAPP_APPROVAL_META_TEMPLATE,
  WHATSAPP_DECLINE_META_TEMPLATE,
  approvalEmailHtml,
  declineEmailHtml,
  normalizeWhatsappPhone,
  renderApprovalEmailText,
  renderDeclineEmailText,
  whatsappApprovalBodyVariables,
  whatsappDeclineBodyVariables,
  type DeclineChannelOutcome,
} from "@/lib/messaging/templates";
import { loadDeliveryConfig, type DeliveryConfig } from "./invite-delivery";
import type { Context } from "./context";

type Db = Context["supabase"];
const log = createLogger("media-review-notice");

export type DeclineDeliveryResult = {
  email?: DeclineChannelOutcome;
  whatsapp?: DeclineChannelOutcome;
};

export type MediaReviewNoticeDeliveryResult = DeclineDeliveryResult;

type NoticeCopy = {
  label: string;
  emailSubject: string;
  renderText: (name: string) => string;
  renderHtml: (name: string) => string;
  waTemplateName: string;
  waVariables: (name: string) => string[];
};

const DECLINE_NOTICE: NoticeCopy = {
  label: "decline rejection",
  emailSubject: DECLINE_EMAIL_SUBJECT,
  renderText: renderDeclineEmailText,
  renderHtml: declineEmailHtml,
  waTemplateName: WHATSAPP_DECLINE_META_TEMPLATE.name,
  waVariables: whatsappDeclineBodyVariables,
};

const APPROVAL_NOTICE: NoticeCopy = {
  label: "approval shortlist",
  emailSubject: APPROVAL_EMAIL_SUBJECT,
  renderText: renderApprovalEmailText,
  renderHtml: approvalEmailHtml,
  waTemplateName: WHATSAPP_APPROVAL_META_TEMPLATE.name,
  waVariables: whatsappApprovalBodyVariables,
};

async function sendNoticeEmail(
  cfg: DeliveryConfig,
  to: string | null | undefined,
  name: string,
  notice: NoticeCopy,
): Promise<DeclineChannelOutcome> {
  const provider =
    cfg.defaultEmailProvider || (cfg.brevo && !cfg.resend ? "brevo" : "resend");
  const subject = notice.emailSubject;
  const text = notice.renderText(name);
  const html = notice.renderHtml(name);

  if (!to?.trim()) return { status: "skipped", error: "No email address" };

  if (provider === "brevo") {
    if (!cfg.brevo) return { status: "failed", error: "Brevo is not configured" };
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
    return { status: r.ok ? "sent" : "failed", error: r.error };
  }

  if (!cfg.resend) return { status: "failed", error: "Resend is not configured" };
  const r = await sendResendEmail({
    apiKey: cfg.resend.apiKey,
    from: cfg.resend.from,
    replyTo: cfg.resend.replyTo,
    to,
    subject,
    text,
    html,
  });
  return { status: r.ok ? "sent" : "failed", error: r.error };
}

async function sendNoticeWhatsapp(
  cfg: DeliveryConfig,
  phoneRaw: string | null | undefined,
  name: string,
  notice: NoticeCopy,
): Promise<DeclineChannelOutcome> {
  if (!cfg.resilio) return { status: "failed", error: "ResilioHub WhatsApp is not configured" };
  const to = normalizeWhatsappPhone(phoneRaw);
  if (!to) {
    return {
      status: "skipped",
      error: phoneRaw?.trim() ? "Phone needs a country code (e.g. +91…)" : "No phone number",
    };
  }
  const r = await sendResilioTemplate({
    apiKey: cfg.resilio.apiKey,
    baseUrl: cfg.resilio.baseUrl,
    to,
    templateName: notice.waTemplateName,
    bodyVariables: notice.waVariables(name),
  });
  return { status: r.ok ? "sent" : "failed", error: r.error };
}

async function sendMediaReviewNotice(
  supabase: Db,
  sessionId: string,
  organizationId: string,
  notice: NoticeCopy,
): Promise<MediaReviewNoticeDeliveryResult> {
  const out: MediaReviewNoticeDeliveryResult = {};
  try {
    const { data: session } = await supabase
      .from("sessions")
      .select("id, candidateId")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session?.candidateId) {
      const skip: DeclineChannelOutcome = { status: "skipped", error: "No candidate on session" };
      out.email = skip;
      out.whatsapp = skip;
      return out;
    }

    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, name, email, phone")
      .eq("id", session.candidateId)
      .maybeSingle();

    if (!candidate) {
      const skip: DeclineChannelOutcome = { status: "skipped", error: "No candidate on session" };
      out.email = skip;
      out.whatsapp = skip;
      return out;
    }

    const name = candidate.name?.trim() || "there";
    const cfg = await loadDeliveryConfig(supabase, organizationId);
    out.email = await sendNoticeEmail(cfg, candidate.email, name, notice);
    out.whatsapp = await sendNoticeWhatsapp(cfg, candidate.phone, name, notice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    log.error(`${notice.label} failed`, sessionId, msg);
    const fail: DeclineChannelOutcome = { status: "failed", error: msg };
    if (!out.email) out.email = fail;
    if (!out.whatsapp) out.whatsapp = fail;
  }
  return out;
}

/** Never throws. Best-effort rejection notice after media Decline. */
export async function sendDeclineRejection(
  supabase: Db,
  sessionId: string,
  organizationId: string,
): Promise<DeclineDeliveryResult> {
  return sendMediaReviewNotice(supabase, sessionId, organizationId, DECLINE_NOTICE);
}

/** Never throws. Best-effort shortlist notice after media Approve. */
export async function sendApprovalShortlist(
  supabase: Db,
  sessionId: string,
  organizationId: string,
): Promise<MediaReviewNoticeDeliveryResult> {
  return sendMediaReviewNotice(supabase, sessionId, organizationId, APPROVAL_NOTICE);
}
