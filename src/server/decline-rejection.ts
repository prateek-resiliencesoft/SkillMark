import "server-only";
import { createLogger } from "@/lib/logger";
import { sendBrevoEmail, sendResendEmail, sendResilioTemplate } from "@/lib/messaging/providers";
import {
  APPROVAL_EMAIL_SUBJECT,
  DECLINE_EMAIL_SUBJECT,
  DECLINE_WITH_REASON_EMAIL_SUBJECT,
  WHATSAPP_APPROVAL_META_TEMPLATE,
  WHATSAPP_DECLINE_META_TEMPLATE,
  WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE,
  approvalEmailHtml,
  declineEmailHtml,
  declineWithReasonEmailHtml,
  hasDeclineReason,
  normalizeWhatsappPhone,
  renderApprovalEmailText,
  renderDeclineEmailText,
  renderDeclineWithReasonEmailText,
  whatsappApprovalBodyVariables,
  whatsappDeclineBodyVariables,
  whatsappDeclineWithReasonBodyVariables,
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

type NoticeContext = { name: string; interviewTitle: string; reason?: string };

type NoticeCopy = {
  label: string;
  emailSubject: string;
  renderText: (ctx: NoticeContext) => string;
  renderHtml: (ctx: NoticeContext) => string;
  waTemplateName: string;
  waVariables: (ctx: NoticeContext) => string[];
};

const DECLINE_NOTICE: NoticeCopy = {
  label: "decline rejection",
  emailSubject: DECLINE_EMAIL_SUBJECT,
  renderText: ({ name }) => renderDeclineEmailText(name),
  renderHtml: ({ name }) => declineEmailHtml(name),
  waTemplateName: WHATSAPP_DECLINE_META_TEMPLATE.name,
  waVariables: ({ name }) => whatsappDeclineBodyVariables(name),
};

const DECLINE_NOTICE_WITH_REASON: NoticeCopy = {
  label: "decline rejection with reason",
  emailSubject: DECLINE_WITH_REASON_EMAIL_SUBJECT,
  renderText: ({ name, reason }) => renderDeclineWithReasonEmailText(name, reason ?? ""),
  renderHtml: ({ name, reason }) => declineWithReasonEmailHtml(name, reason ?? ""),
  waTemplateName: WHATSAPP_DECLINE_WITH_REASON_META_TEMPLATE.name,
  waVariables: ({ name, reason }) => whatsappDeclineWithReasonBodyVariables(name, reason ?? ""),
};

const APPROVAL_NOTICE: NoticeCopy = {
  label: "approval shortlist",
  emailSubject: APPROVAL_EMAIL_SUBJECT,
  renderText: ({ name, interviewTitle }) => renderApprovalEmailText(name, interviewTitle),
  renderHtml: ({ name, interviewTitle }) => approvalEmailHtml(name, interviewTitle),
  waTemplateName: WHATSAPP_APPROVAL_META_TEMPLATE.name,
  waVariables: ({ name, interviewTitle }) => whatsappApprovalBodyVariables(name, interviewTitle),
};

async function sendNoticeEmail(
  cfg: DeliveryConfig,
  to: string | null | undefined,
  ctx: NoticeContext,
  notice: NoticeCopy,
): Promise<DeclineChannelOutcome> {
  const provider =
    cfg.defaultEmailProvider || (cfg.brevo && !cfg.resend ? "brevo" : "resend");
  const subject = notice.emailSubject;
  const text = notice.renderText(ctx);
  const html = notice.renderHtml(ctx);

  if (!to?.trim()) return { status: "skipped", error: "No email address" };

  if (provider === "brevo") {
    if (!cfg.brevo) return { status: "failed", error: "Brevo is not configured" };
    const r = await sendBrevoEmail({
      apiKey: cfg.brevo.apiKey,
      fromEmail: cfg.brevo.fromEmail,
      fromName: "RESILIENCESOFT",
      toEmail: to,
      toName: ctx.name,
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
  ctx: NoticeContext,
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
    bodyVariables: notice.waVariables(ctx),
  });
  return { status: r.ok ? "sent" : "failed", error: r.error };
}

async function sendMediaReviewNotice(
  supabase: Db,
  sessionId: string,
  organizationId: string,
  notice: NoticeCopy,
  reason?: string,
): Promise<MediaReviewNoticeDeliveryResult> {
  const out: MediaReviewNoticeDeliveryResult = {};
  try {
    const { data: session } = await supabase
      .from("sessions")
      .select("id, candidateId, interview:interviews(title)")
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTitle = ((session as any).interview?.title as string | undefined) ?? "Interview";
    const interviewTitle = rawTitle.split(" · ")[0] || "Interview";
    const ctx: NoticeContext = {
      name: candidate.name?.trim() || "there",
      interviewTitle,
      reason,
    };
    const cfg = await loadDeliveryConfig(supabase, organizationId);
    out.email = await sendNoticeEmail(cfg, candidate.email, ctx, notice);
    out.whatsapp = await sendNoticeWhatsapp(cfg, candidate.phone, ctx, notice);
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
  opts?: { reason?: string | null },
): Promise<DeclineDeliveryResult> {
  const reason = opts?.reason?.trim() || "";
  const notice = hasDeclineReason(reason) ? DECLINE_NOTICE_WITH_REASON : DECLINE_NOTICE;
  return sendMediaReviewNotice(
    supabase,
    sessionId,
    organizationId,
    notice,
    reason || undefined,
  );
}

/** Never throws. Best-effort shortlist notice after media Approve. */
export async function sendApprovalShortlist(
  supabase: Db,
  sessionId: string,
  organizationId: string,
): Promise<MediaReviewNoticeDeliveryResult> {
  return sendMediaReviewNotice(supabase, sessionId, organizationId, APPROVAL_NOTICE);
}
