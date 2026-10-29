/**
 * Invite message templates (shared by server send + settings preview).
 *
 * Placeholders: {{name}} {{interviewTitle}} {{organization}} {{link}}
 * {{duration}} {{batchName}} {{scheduleNotice}}
 */

export interface MessageTemplates {
  emailSubject: string;
  emailBody: string;
  whatsappBody: string;
}

export interface TemplateVars {
  name: string;
  interviewTitle: string;
  organization: string;
  link: string;
  duration: string;
  batchName: string;
  scheduledAt?: string;
  expiresAt?: string;
  scheduleNotice?: string;
}

export const TEMPLATE_PLACEHOLDERS: (keyof TemplateVars)[] = [
  "name",
  "interviewTitle",
  "organization",
  "link",
  "duration",
  "batchName",
  "scheduleNotice",
];

export function formatDateTime(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return String(d);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatScheduleNotice(
  scheduledAt?: string | Date | null,
  expiresAt?: string | Date | null,
): string {
  const hasSched = !!scheduledAt;
  const hasExp = !!expiresAt;

  if (hasSched && hasExp) {
    return `Scheduled for: ${formatDateTime(scheduledAt)} · Link active until: ${formatDateTime(expiresAt)}`;
  }
  if (hasSched) {
    return `Scheduled for: ${formatDateTime(scheduledAt)}`;
  }
  if (hasExp) {
    return `Link active until: ${formatDateTime(expiresAt)}`;
  }
  return "You may start at your convenience.";
}

export const DEFAULT_TEMPLATES: MessageTemplates = {
  emailSubject: "Your interview invitation: {{interviewTitle}}",
  emailBody: `Hello {{name}}, your interview for {{interviewTitle}} with {{organization}} is ready.

{{scheduleNotice}}

Start here:
{{link}}

This link is personal to you. Please open it on a laptop using Chrome or Edge, with a working microphone and camera.`,
  whatsappBody: `Hello {{1}}, your interview for {{2}} with {{3}} is ready.

{{4}}

Start here: {{5}}

This link is personal to you. Please open it on a laptop using Chrome or Edge, with a working microphone and camera.`,
};

/**
 * Text to submit in ResilioHub → Templates (category: UTILITY). WhatsApp
 * business-initiated messages must use an approved template, so this body is
 * fixed by Meta; we fill its variables:
 * {{1}} name, {{2}} interview title, {{3}} organization, {{4}} schedule notice, {{5}} link.
 */
export const WHATSAPP_META_TEMPLATE = {
  name: "interview_invite",
  category: "UTILITY",
  language: "en",
  body: `Hello {{1}}, your interview for {{2}} with {{3}} is ready.

{{4}}

Start here: {{5}}

This link is personal to you. Please open it on a laptop using Chrome or Edge, with a working microphone and camera.`,
  example: [
    "Priya Sharma",
    "Senior React Developer",
    "Acme Corp",
    "Scheduled for: Sat, Nov 2, 10:00 AM · Link active until: Sun, Nov 3, 11:59 PM",
    "https://app.example.com/i/invite/abc123xyz789",
  ],
};

export function whatsappBodyVariables(v: TemplateVars): string[] {
  const notice = v.scheduleNotice ?? formatScheduleNotice(v.scheduledAt, v.expiresAt);
  return [v.name, v.interviewTitle, v.organization, notice, v.link];
}

export function renderWhatsappPreview(v: TemplateVars, customBody?: string): string {
  const notice = v.scheduleNotice ?? formatScheduleNotice(v.scheduledAt, v.expiresAt);
  const values = [v.name, v.interviewTitle, v.organization, notice, v.link];
  const template = customBody?.trim() || WHATSAPP_META_TEMPLATE.body;
  let text = template.replace(/\{\{(\d)\}\}/g, (m, i: string) => values[Number(i) - 1] ?? m);
  text = renderTemplate(text, { ...v, scheduleNotice: notice });
  return text;
}

export function mergeTemplates(stored: Partial<MessageTemplates> | null | undefined): MessageTemplates {
  return {
    emailSubject: stored?.emailSubject?.trim() || DEFAULT_TEMPLATES.emailSubject,
    emailBody: stored?.emailBody?.trim() || DEFAULT_TEMPLATES.emailBody,
    whatsappBody: stored?.whatsappBody?.trim() || DEFAULT_TEMPLATES.whatsappBody,
  };
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const fullVars = {
    ...vars,
    scheduleNotice: vars.scheduleNotice ?? formatScheduleNotice(vars.scheduledAt, vars.expiresAt),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) =>
    k in fullVars ? fullVars[k as keyof TemplateVars] ?? "" : m,
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-text body → simple, spam-filter-friendly HTML with a CTA button. */
export function emailHtml(body: string, vars: TemplateVars): string {
  const fullVars = {
    ...vars,
    scheduleNotice: vars.scheduleNotice ?? formatScheduleNotice(vars.scheduledAt, vars.expiresAt),
  };
  const text = renderTemplate(body, fullVars);
  const link = escapeHtml(fullVars.link);
  const button = `<p style="margin:24px 0"><a href="${link}" style="background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Start interview</a></p><p style="margin:0 0 16px;font-size:12px;color:#6b7280;word-break:break-all">Or copy this link: ${link}</p>`;
  const para = (lines: string[]) =>
    lines.length
      ? `<p style="margin:0 0 16px">${lines.join("<br>").split(link).join(`<a href="${link}">${link}</a>`)}</p>`
      : "";
  // A line holding only the link becomes the CTA button; other links stay inline.
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => {
      const out: string[] = [];
      let buf: string[] = [];
      for (const line of p.split("\n")) {
        if (line.trim() === link) {
          out.push(para(buf), button);
          buf = [];
        } else {
          buf.push(line);
        }
      }
      out.push(para(buf));
      return out.join("");
    })
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:15px;line-height:1.55"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">${paragraphs}</div></body></html>`;
}
