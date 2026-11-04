import "server-only";
import { decryptSecret } from "@/lib/messaging/secrets";
import { sendBrevoEmail, sendResendEmail, sendResilioTemplate } from "@/lib/messaging/providers";
import {
  emailHtml,
  formatScheduleNotice,
  mergeTemplates,
  renderTemplate,
  whatsappBodyVariables,
  type MessageTemplates,
  type TemplateVars,
} from "@/lib/messaging/templates";
import { inviteLink } from "./batch-access";
import type { Context } from "./context";

type Db = Context["supabase"];

export interface DeliveryConfig {
  organizationName: string;
  templates: MessageTemplates;
  defaultEmailProvider: "resend" | "brevo";
  defaultWhatsappProvider: "resilio";
  resend: { apiKey: string; from: string; replyTo: string | null } | null;
  brevo: { apiKey: string; fromEmail: string; fromName: string | null; replyTo: string | null } | null;
  resilio: { apiKey: string; baseUrl: string | null; templateName: string } | null;
  outboundWebhook: { url: string; secret: string | null; events: string[] } | null;
  inboundWebhookSecret: string | null;
}

export async function loadDeliveryConfig(supabase: Db, organizationId: string): Promise<DeliveryConfig> {
  const [{ data: org }, { data: row }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", organizationId).single(),
    supabase.from("org_integrations").select("*").eq("organizationId", organizationId).maybeSingle(),
  ]);
  const resendKey = decryptSecret(row?.resendApiKey);
  const brevoKey = decryptSecret(row?.brevoApiKey);
  const resilioKey = decryptSecret(row?.resilioApiKey);

  return {
    organizationName: org?.name && org.name !== "Personal" ? org.name : "ResilienceSoft Interview",
    templates: mergeTemplates(row?.messageTemplates),
    defaultEmailProvider: (row?.defaultEmailProvider as "resend" | "brevo") || "resend",
    defaultWhatsappProvider: "resilio",
    resend:
      resendKey && row?.resendFrom
        ? { apiKey: resendKey, from: row.resendFrom, replyTo: row.resendReplyTo ?? null }
        : null,
    brevo:
      brevoKey && row?.brevoFromEmail
        ? {
            apiKey: brevoKey,
            fromEmail: row.brevoFromEmail,
            fromName: row.brevoFromName ?? null,
            replyTo: row.brevoReplyTo ?? null,
          }
        : null,
    resilio:
      resilioKey && row?.resilioTemplateName
        ? { apiKey: resilioKey, baseUrl: row.resilioBaseUrl ?? null, templateName: row.resilioTemplateName }
        : null,
    outboundWebhook: row?.outboundWebhookUrl
      ? {
          url: row.outboundWebhookUrl,
          secret: decryptSecret(row.outboundWebhookSecret) ?? null,
          events: (row.outboundWebhookEvents as string[]) ?? ["candidate.invited", "session.started", "session.completed"],
        }
      : null,
    inboundWebhookSecret: (row?.inboundWebhookSecret as string | null) ?? null,
  };
}

export type ChannelOutcome = "sent" | "failed" | "skipped";

export async function deliverEmail(
  cfg: DeliveryConfig,
  to: string | null,
  vars: TemplateVars,
  idempotencyKey?: string,
  preferredProvider?: "resend" | "brevo",
) {
  const provider =
    preferredProvider ||
    cfg.defaultEmailProvider ||
    (cfg.brevo && !cfg.resend ? "brevo" : "resend");

  if (!to) return { status: "skipped" as ChannelOutcome, error: "No email address", provider };

  const subject = renderTemplate(cfg.templates.emailSubject, vars);
  const text = renderTemplate(cfg.templates.emailBody, vars);
  const html = emailHtml(cfg.templates.emailBody, vars);

  if (provider === "brevo") {
    if (!cfg.brevo) return { status: "failed" as ChannelOutcome, error: "Brevo is not configured", provider: "brevo" };
    const r = await sendBrevoEmail({
      apiKey: cfg.brevo.apiKey,
      fromEmail: cfg.brevo.fromEmail,
      fromName: cfg.brevo.fromName || cfg.organizationName,
      toEmail: to,
      toName: vars.name,
      replyTo: cfg.brevo.replyTo,
      subject,
      html,
      text,
    });
    return { status: (r.ok ? "sent" : "failed") as ChannelOutcome, error: r.error, provider: "brevo" };
  }

  // Resend
  if (!cfg.resend) return { status: "failed" as ChannelOutcome, error: "Resend is not configured", provider: "resend" };
  const r = await sendResendEmail({
    apiKey: cfg.resend.apiKey,
    from: cfg.resend.from,
    replyTo: cfg.resend.replyTo,
    to,
    subject,
    text,
    html,
    idempotencyKey,
  });
  return { status: (r.ok ? "sent" : "failed") as ChannelOutcome, error: r.error, provider: "resend" };
}

export async function deliverWhatsapp(cfg: DeliveryConfig, to: string | null, vars: TemplateVars) {
  if (!cfg.resilio) return { status: "failed" as ChannelOutcome, error: "ResilioHub WhatsApp is not configured" };
  if (!to) return { status: "skipped" as ChannelOutcome, error: "No phone number" };
  if (!to.startsWith("+")) return { status: "skipped" as ChannelOutcome, error: "Phone needs a country code (e.g. +91…)" };
  const r = await sendResilioTemplate({
    apiKey: cfg.resilio.apiKey,
    baseUrl: cfg.resilio.baseUrl,
    to,
    templateName: cfg.resilio.templateName,
    bodyVariables: whatsappBodyVariables(vars),
  });
  return { status: (r.ok ? "sent" : "failed") as ChannelOutcome, error: r.error, provider: "resilio" };
}

type ChannelResult = { status: ChannelOutcome; error?: string };
export interface InviteDeliveryResult {
  email?: ChannelResult;
  whatsapp?: ChannelResult;
}

/** Send invite link for one candidate. Never throws — errors returned per channel. */
export async function sendCandidateInvite(
  supabase: Db,
  organizationId: string,
  candidateId: string,
  channels: { email: boolean; whatsapp: boolean },
): Promise<InviteDeliveryResult> {
  const out: InviteDeliveryResult = {};
  if (!channels.email && !channels.whatsapp) return out;
  try {
    const { data: c } = await supabase
      .from("candidates")
      .select("id, name, email, phone, inviteToken, scheduledAt, expiresAt, interview:interviews(title, timeLimitMinutes)")
      .eq("id", candidateId)
      .single();
    if (!c || !c.inviteToken) {
      const r: ChannelResult = { status: "failed", error: "Candidate has no invite link" };
      if (channels.email) out.email = r;
      if (channels.whatsapp) out.whatsapp = r;
      return out;
    }
    const cfg = await loadDeliveryConfig(supabase, organizationId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iv = c.interview as any;
    const title = ((iv?.title as string | undefined) ?? "Interview").split(" · ")[0];
    const vars: TemplateVars = {
      name: c.name,
      interviewTitle: title,
      organization: cfg.organizationName,
      link: inviteLink(c.inviteToken),
      duration: iv?.timeLimitMinutes ? `${iv.timeLimitMinutes} minutes` : "",
      batchName: title,
      scheduledAt: (c.scheduledAt as string | null) ?? undefined,
      expiresAt: (c.expiresAt as string | null) ?? undefined,
      scheduleNotice: formatScheduleNotice(c.scheduledAt as string | null, c.expiresAt as string | null),
    };
    const update: Record<string, unknown> = {};
    const errors: string[] = [];
    if (channels.email) {
      const r = await deliverEmail(cfg, c.email, vars);
      out.email = { status: r.status, error: r.error };
      update.emailStatus = r.status;
      update.emailProvider = r.provider;
      if (r.status === "sent") update.emailSentAt = new Date().toISOString();
      if (r.error) errors.push(`Email (${r.provider}): ${r.error}`);
    }
    if (channels.whatsapp) {
      const phone = (c.phone as string | null)?.replace(/[\s()-]/g, "") || null;
      const r = await deliverWhatsapp(cfg, phone, vars);
      out.whatsapp = { status: r.status, error: r.error };
      update.whatsappStatus = r.status;
      update.whatsappProvider = r.provider ?? "resilio";
      if (r.status === "sent") update.whatsappSentAt = new Date().toISOString();
      if (r.error) errors.push(`WhatsApp: ${r.error}`);
    }
    update.lastSendError = errors.length ? errors.join(" · ").slice(0, 500) : null;
    await supabase.from("candidates").update(update).eq("id", c.id);
  } catch (err) {
    const r: ChannelResult = { status: "failed", error: err instanceof Error ? err.message : "Send failed" };
    if (channels.email && !out.email) out.email = r;
    if (channels.whatsapp && !out.whatsapp) out.whatsapp = r;
  }
  return out;
}

/** Resolve form invite schedule/expiry presets into ISO timestamps. */
export function resolveInviteSchedule(settings: {
  inviteSchedule?: "immediate" | "tomorrow" | "next_week" | "custom";
  inviteScheduledAt?: string | null;
  linkExpiryDays?: number | null;
}): { scheduledAt: string | null; expiresAt: string | null } {
  const now = new Date();
  let scheduledAt: string | null = null;
  const schedule = settings.inviteSchedule ?? "immediate";
  if (schedule === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    scheduledAt = d.toISOString();
  } else if (schedule === "next_week") {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(10, 0, 0, 0);
    scheduledAt = d.toISOString();
  } else if (schedule === "custom" && settings.inviteScheduledAt) {
    const t = Date.parse(settings.inviteScheduledAt);
    if (!Number.isNaN(t)) scheduledAt = new Date(t).toISOString();
  }

  let expiresAt: string | null = null;
  // Default 7-day expiry when unset; explicit 0/null = no expiry.
  const days =
    settings.linkExpiryDays === undefined || settings.linkExpiryDays === null
      ? settings.linkExpiryDays === null
        ? 0
        : 7
      : settings.linkExpiryDays;
  if (typeof days === "number" && days > 0) {
    const base = scheduledAt ? new Date(scheduledAt) : now;
    const e = new Date(base);
    e.setDate(e.getDate() + days);
    expiresAt = e.toISOString();
  }
  return { scheduledAt, expiresAt };
}
