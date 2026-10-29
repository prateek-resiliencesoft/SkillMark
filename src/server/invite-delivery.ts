import "server-only";
import { decryptSecret } from "@/lib/messaging/secrets";
import { sendBrevoEmail, sendResendEmail, sendResilioTemplate } from "@/lib/messaging/providers";
import {
  emailHtml,
  mergeTemplates,
  renderTemplate,
  whatsappBodyVariables,
  type MessageTemplates,
  type TemplateVars,
} from "@/lib/messaging/templates";
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
    organizationName: org?.name && org.name !== "Personal" ? org.name : "Skillmark",
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
          secret: row.outboundWebhookSecret ?? null,
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
