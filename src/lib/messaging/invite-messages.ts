/**
 * Snapshots of invite email / WhatsApp bodies saved at send time, plus
 * reconstruction from current org templates when a snapshot is missing.
 */
import {
  formatScheduleNotice,
  renderTemplate,
  renderWhatsappPreview,
  type MessageTemplates,
  type TemplateVars,
} from "./templates";

export type InviteEmailSnapshot = {
  subject: string;
  text: string;
  sentAt: string;
  provider: string;
  to: string;
};

export type InviteWhatsappSnapshot = {
  text: string;
  sentAt: string;
  provider: string;
  to: string;
  templateName?: string;
};

export type InviteMessages = {
  email?: InviteEmailSnapshot;
  whatsapp?: InviteWhatsappSnapshot;
};

export type InviteMessageView = {
  channel: "email" | "whatsapp";
  source: "exact" | "reconstructed";
  status: string | null;
  sentAt: string | null;
  provider: string | null;
  to: string | null;
  subject?: string | null;
  text: string | null;
  templateName?: string | null;
};

export function parseInviteMessages(raw: unknown): InviteMessages {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: InviteMessages = {};
  const email = o.email;
  if (email && typeof email === "object" && !Array.isArray(email)) {
    const e = email as Record<string, unknown>;
    if (typeof e.subject === "string" && typeof e.text === "string") {
      out.email = {
        subject: e.subject,
        text: e.text,
        sentAt: typeof e.sentAt === "string" ? e.sentAt : "",
        provider: typeof e.provider === "string" ? e.provider : "",
        to: typeof e.to === "string" ? e.to : "",
      };
    }
  }
  const wa = o.whatsapp;
  if (wa && typeof wa === "object" && !Array.isArray(wa)) {
    const w = wa as Record<string, unknown>;
    if (typeof w.text === "string") {
      out.whatsapp = {
        text: w.text,
        sentAt: typeof w.sentAt === "string" ? w.sentAt : "",
        provider: typeof w.provider === "string" ? w.provider : "",
        to: typeof w.to === "string" ? w.to : "",
        templateName: typeof w.templateName === "string" ? w.templateName : undefined,
      };
    }
  }
  return out;
}

export function mergeInviteMessages(prev: unknown, patch: InviteMessages): InviteMessages {
  return { ...parseInviteMessages(prev), ...patch };
}

export function buildInviteMessageViews(input: {
  inviteMessages: unknown;
  templates: MessageTemplates;
  vars: TemplateVars;
  email?: string | null;
  phone?: string | null;
  emailStatus?: string | null;
  emailSentAt?: string | null;
  emailProvider?: string | null;
  whatsappStatus?: string | null;
  whatsappSentAt?: string | null;
  whatsappProvider?: string | null;
  whatsappTemplateName?: string | null;
}): InviteMessageView[] {
  const saved = parseInviteMessages(input.inviteMessages);
  const views: InviteMessageView[] = [];

  if (saved.email) {
    views.push({
      channel: "email",
      source: "exact",
      status: input.emailStatus ?? "sent",
      sentAt: saved.email.sentAt || input.emailSentAt || null,
      provider: saved.email.provider || input.emailProvider || null,
      to: saved.email.to || input.email || null,
      subject: saved.email.subject,
      text: saved.email.text,
    });
  } else if (input.email) {
    views.push({
      channel: "email",
      source: "reconstructed",
      status: input.emailStatus ?? null,
      sentAt: input.emailSentAt ?? null,
      provider: input.emailProvider ?? null,
      to: input.email,
      subject: renderTemplate(input.templates.emailSubject, input.vars),
      text: renderTemplate(input.templates.emailBody, input.vars),
    });
  }

  if (saved.whatsapp) {
    views.push({
      channel: "whatsapp",
      source: "exact",
      status: input.whatsappStatus ?? "sent",
      sentAt: saved.whatsapp.sentAt || input.whatsappSentAt || null,
      provider: saved.whatsapp.provider || input.whatsappProvider || null,
      to: saved.whatsapp.to || input.phone || null,
      text: saved.whatsapp.text,
      templateName: saved.whatsapp.templateName ?? input.whatsappTemplateName ?? null,
    });
  } else if (input.phone) {
    views.push({
      channel: "whatsapp",
      source: "reconstructed",
      status: input.whatsappStatus ?? null,
      sentAt: input.whatsappSentAt ?? null,
      provider: input.whatsappProvider ?? null,
      to: input.phone,
      text: renderWhatsappPreview(input.vars, input.templates.whatsappBody),
      templateName: input.whatsappTemplateName ?? null,
    });
  }

  return views;
}

export function inviteVarsFromParts(input: {
  name: string;
  interviewTitle: string;
  organization: string;
  link: string;
  duration?: string;
  batchName?: string;
  scheduledAt?: string | null;
  expiresAt?: string | null;
}): TemplateVars {
  return {
    name: input.name,
    interviewTitle: input.interviewTitle,
    organization: input.organization,
    link: input.link,
    duration: input.duration ?? "",
    batchName: input.batchName ?? input.interviewTitle,
    scheduledAt: input.scheduledAt ?? undefined,
    expiresAt: input.expiresAt ?? undefined,
    scheduleNotice: formatScheduleNotice(input.scheduledAt, input.expiresAt),
  };
}
