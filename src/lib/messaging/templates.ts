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

/**
 * Meta UTILITY template for team alerts when a candidate finishes.
 * {{1}} recipient name, {{2}} candidate name, {{3}} interview title,
 * {{4}} organization, {{5}} report deep-link.
 */
export const WHATSAPP_COMPLETION_META_TEMPLATE = {
  name: "interview_completed",
  category: "UTILITY",
  language: "en",
  // Meta rejects bodies that end on a variable — keep a fixed sentence after {{5}}.
  body: `Hi {{1}}, {{2}} just completed the interview for {{3}} at {{4}}.

Open the report here:
{{5}}

Thanks — Resiliencesoft Interview AI.`,
  example: [
    "Alex Chen",
    "Priya Sharma",
    "Senior React Developer",
    "Acme Corp",
    "https://app.example.com/interviews/abc/results?session=xyz",
  ],
};

export interface CompletionTemplateVars {
  recipientName: string;
  candidateName: string;
  interviewTitle: string;
  organization: string;
  link: string;
}

export function whatsappBodyVariables(v: TemplateVars): string[] {
  const notice = v.scheduleNotice ?? formatScheduleNotice(v.scheduledAt, v.expiresAt);
  return [v.name, v.interviewTitle, v.organization, notice, v.link];
}

export function whatsappCompletionBodyVariables(v: CompletionTemplateVars): string[] {
  return [v.recipientName, v.candidateName, v.interviewTitle, v.organization, v.link];
}

export function renderWhatsappPreview(v: TemplateVars, customBody?: string): string {
  const notice = v.scheduleNotice ?? formatScheduleNotice(v.scheduledAt, v.expiresAt);
  const values = [v.name, v.interviewTitle, v.organization, notice, v.link];
  const template = customBody?.trim() || WHATSAPP_META_TEMPLATE.body;
  let text = template.replace(/\{\{(\d)\}\}/g, (m, i: string) => values[Number(i) - 1] ?? m);
  text = renderTemplate(text, { ...v, scheduleNotice: notice });
  return text;
}

/**
 * Meta UTILITY template sent automatically when a candidate leaves a live
 * interview midway (session → ABANDONED). Body must match the approved template.
 * {{1}} candidate name, {{2}} project contact number, {{3}} invite link,
 * {{4}} link expiry date, {{5}} link expiry time, {{6}} organization name.
 */
export const WHATSAPP_FOLLOWUP_META_TEMPLATE = {
  // v2: body wording changed (restart, not resume) — Meta needs the new text approved under a new name.
  name: "left_interview_followup_v2",
  category: "UTILITY",
  language: "en_US",
  body: `Hi {{1}}, You left your interview in the middle. Is there any issue? If so, please contact us directly at {{2}}. Or you can restart your interview using this link: {{3}} This link is valid until your original interview link expires on {{4}} at {{5}}. Team {{6}}©`,
  example: [
    "Priya Sharma",
    "+919876543210",
    "https://app.example.com/i/invite/abc123xyz789",
    "Nov 26, 2026",
    "11:59 PM",
    "Acme Corp",
  ],
};

export interface FollowupTemplateVars {
  name: string;
  supportPhone: string;
  link: string;
  expiresAt: string | Date;
  organization: string;
}

/** Default zone for the expiry text: no per-org/project timezone setting exists, and the audience is India. */
export const FOLLOWUP_DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function followupExpiryParts(
  expiresAt: string | Date,
  timeZone: string = FOLLOWUP_DEFAULT_TIME_ZONE,
): { date: string; time: string } {
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const fmt = (tz: string) => ({
    date: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(d),
    // Newer ICU puts a narrow no-break space before AM/PM; WhatsApp variables want a plain space.
    time: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
      .format(d)
      .replace(/\u202f/g, " "),
  });
  try {
    return fmt(timeZone);
  } catch {
    return fmt(FOLLOWUP_DEFAULT_TIME_ZONE); // invalid IANA zone
  }
}

/**
 * Normalise a phone number for WhatsApp to E.164, or null if not plausible.
 * Strips spaces/()/-; "00…" → "+…"; Indian 10-digit mobile (6-9…) → "+91…";
 * 12 digits starting 91 → "+91…". Result must be + then 8-15 digits.
 */
export function normalizeWhatsappPhone(raw: string | null | undefined): string | null {
  let p = String(raw ?? "").replace(/[\s()-]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  else if (/^[6-9]\d{9}$/.test(p)) p = `+91${p}`;
  else if (/^91\d{10}$/.test(p)) p = `+${p}`;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

export function followupBodyVariables(v: FollowupTemplateVars, timeZone?: string): string[] {
  const { date, time } = followupExpiryParts(v.expiresAt, timeZone);
  return [v.name, v.supportPhone, v.link, date, time, v.organization];
}

/** Preview of the follow-up body with the given values (defaults to the Meta example). */
export function renderWhatsappFollowupPreview(values: string[] = WHATSAPP_FOLLOWUP_META_TEMPLATE.example): string {
  return WHATSAPP_FOLLOWUP_META_TEMPLATE.body.replace(/\{\{(\d)\}\}/g, (m, i: string) => values[Number(i) - 1] ?? m);
}

export function renderWhatsappCompletionPreview(
  v: CompletionTemplateVars,
  customBody?: string,
): string {
  const values = whatsappCompletionBodyVariables(v);
  const template = customBody?.trim() || WHATSAPP_COMPLETION_META_TEMPLATE.body;
  return template.replace(/\{\{(\d)\}\}/g, (m, i: string) => values[Number(i) - 1] ?? m);
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
