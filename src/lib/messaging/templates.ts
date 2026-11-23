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
 * Meta UTILITY template for incomplete / abandoned interviews (manual Send follow-up
 * or auto when interviews.autoLeftFollowup). Body must match the approved WABA template.
 *
 * Exactly 5 body_variables, in this order (screenshot / Meta numbering):
 * {{1}} candidate name
 * {{2}} "RESILIENCESOFT For {position}"  (brand + role in one slot)
 * {{3}} resume invite link
 * {{4}} expiry ("Nov 30, 2026 at 1:05 PM")
 * {{5}} support phone
 */
export const WHATSAPP_FOLLOWUP_META_TEMPLATE = {
  name: "interview_incomplete_reminder",
  category: "UTILITY",
  language: "en",
  body: `Hi {{1}},

Your interview with {{2}} is currently incomplete.

You can resume your interview using the link below:
Resume Interview: {{5}}

Please complete your interview before {{3}}, as the link will expire thereafter.

For any assistance, please contact {{4}}.

Wish you all the best for your interview!
Team RESILIENCESOFT`,
  example: [
    "Prateek",
    "RESILIENCESOFT For MERN Position",
    "https://example.com/restart",
    "2026-12-31 at 23.59",
    "92019 96377",
  ],
};

export const FOLLOWUP_EMAIL_SUBJECT = "Regarding Your Interview with RESILIENCESOFT";

export const FOLLOWUP_BRAND = "RESILIENCESOFT";

export interface FollowupTemplateVars {
  name: string;
  supportPhone: string;
  link: string;
  expiresAt: string | Date;
  /** Interview title / position (e.g. MERN). */
  position: string;
  /** Ignored for Meta body — brand is always RESILIENCESOFT. Kept for callers. */
  organization?: string;
}

/** Default zone for the expiry text: no per-org/project timezone setting exists, and the audience is India. */
export const FOLLOWUP_DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** How far to push link expiry when sending a follow-up and the current deadline is missing/past. */
export const FOLLOWUP_EXTEND_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Split expiry for display. Date = `YYYY-MM-DD`, time = `HH.mm` (24h, Meta sample style
 * e.g. `2023-12-31 at 23.59`). Always derived from the live `expiresAt` value.
 */
export function followupExpiryParts(
  expiresAt: string | Date,
  timeZone: string = FOLLOWUP_DEFAULT_TIME_ZONE,
): { date: string; time: string } {
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid expiresAt: ${String(expiresAt)}`);
  }
  const fmt = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    let hour = get("hour");
    // Some engines emit "24" for midnight; Meta-style expects 00–23.
    if (hour === "24") hour = "00";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${hour}.${get("minute")}`,
    };
  };
  try {
    return fmt(timeZone);
  } catch {
    return fmt(FOLLOWUP_DEFAULT_TIME_ZONE); // invalid IANA zone
  }
}

/** Single Meta {{4}} value: `2026-11-30 at 13.05` from the candidate's expiresAt. */
export function formatFollowupExpiryLabel(
  expiresAt: string | Date,
  timeZone?: string,
): string {
  const { date, time } = followupExpiryParts(expiresAt, timeZone);
  return `${date} at ${time}`;
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

/** {{2}} in Meta: "RESILIENCESOFT For MERN Position" */
export function followupRolePhrase(position: string): string {
  const role = position.trim() || "Interview";
  // Avoid "RESILIENCESOFT For RESILIENCESOFT For …" if title already includes brand.
  if (/^RESILIENCESOFT\s+For\s+/i.test(role)) return role;
  return `${FOLLOWUP_BRAND} For ${role}`;
}

export function followupBodyVariables(v: FollowupTemplateVars, timeZone?: string): string[] {
  // Order is load-bearing — must match Meta slots 1→5 exactly.
  return [
    v.name, // {{1}}
    followupRolePhrase(v.position), // {{2}}
    v.link, // {{3}} resume URL
    formatFollowupExpiryLabel(v.expiresAt, timeZone), // {{4}} live link expiry
    v.supportPhone, // {{5}} contact
  ];
}

export function renderFollowupEmailText(v: FollowupTemplateVars, timeZone?: string): string {
  const expiry = formatFollowupExpiryLabel(v.expiresAt, timeZone);
  const role = followupRolePhrase(v.position);
  return `Hi ${v.name},

Your interview with ${role} is currently incomplete.

You can resume your interview using the link below:
Resume Interview: ${v.link}

Please complete your interview before ${expiry}, as the link will expire thereafter.

For any assistance, please contact ${v.supportPhone}.

Wish you all the best for your interview!
Team ${FOLLOWUP_BRAND}`;
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

/**
 * Meta UTILITY template for candidate rejection on media-review Decline.
 * {{1}} candidate name. Brand is fixed RESILIENCESOFT (not org name).
 */
export const WHATSAPP_DECLINE_META_TEMPLATE = {
  name: "regarding_your_application_with_resiliencesoft",
  category: "UTILITY",
  language: "en",
  body: `Hi {{1}},

Thank you for your interest in joining RESILIENCESOFT and for taking the time to participate in our selection process. After careful consideration, we regret to inform you that we will not be moving forward with your profile for the current opportunity. However, we encourage you to stay connected with us and apply again for future opportunities that match your skills and experience. We appreciate your time and efforts and wish you all the very best for your future career endeavours.

We hope to connect with you again in the future!

Team RESILIENCESOFT`,
  example: ["Priya Sharma"],
};

export const DECLINE_EMAIL_SUBJECT = "Regarding Your Application with RESILIENCESOFT";

export const DECLINE_EMAIL_BODY = `Hi {{name}},

Thank you for your interest in joining RESILIENCESOFT and for taking the time to participate in our selection process. After careful consideration, we regret to inform you that we will not be moving forward with your profile for the current opportunity. However, we encourage you to stay connected with us and apply again for future opportunities that match your skills and experience. We appreciate your time and efforts and wish you all the very best for your future career endeavours.

We hope to connect with you again in the future!

Team RESILIENCESOFT`;

export function whatsappDeclineBodyVariables(name: string): string[] {
  return [name];
}

export function renderDeclineEmailText(name: string): string {
  return DECLINE_EMAIL_BODY.replace(/\{\{\s*name\s*\}\}/g, name);
}

/**
 * Meta UTILITY template for shortlist notice on media-review Approve.
 * {{1}} candidate name. Brand is fixed RESILIENCESOFT (not org name).
 */
export const WHATSAPP_APPROVAL_META_TEMPLATE = {
  name: "candidate_next_round_selected",
  category: "UTILITY",
  language: "en",
  body: `Hi {{1}},

Congratulations! We are pleased to inform you that you have successfully cleared the current round of our selection process and have been shortlisted for the next round. Our team will share the further details and next steps with you shortly. Further details regarding your next round will be shared with you shortly. We appreciate your interest in RESILIENCESOFT and wish you all the best for the next round!

Team RESILIENCESOFT`,
  example: ["Priya Sharma"],
};

export const APPROVAL_EMAIL_SUBJECT = "Congratulations! You've Been Shortlisted – RESILIENCESOFT";

export const APPROVAL_EMAIL_BODY = `Hi {{name}},

Congratulations! We are pleased to inform you that you have successfully cleared the current round of our selection process and have been shortlisted for the next round. Our team will share the further details and next steps with you shortly. Further details regarding your next round will be shared with you shortly. We appreciate your interest in RESILIENCESOFT and wish you all the best for the next round!

Team RESILIENCESOFT`;

export function whatsappApprovalBodyVariables(name: string): string[] {
  return [name];
}

export function renderApprovalEmailText(name: string): string {
  return APPROVAL_EMAIL_BODY.replace(/\{\{\s*name\s*\}\}/g, name);
}

export type DeclineChannelOutcome = {
  status: "sent" | "failed" | "skipped";
  error?: string;
};

/** Alias used by approve + decline media-review notices. */
export type MediaReviewChannelOutcome = DeclineChannelOutcome;

function channelLabel(kind: "Email" | "WhatsApp", r: DeclineChannelOutcome): string {
  if (r.status === "sent") return `${kind} sent`;
  if (r.status === "skipped") return `${kind} skipped${r.error ? ` (${r.error})` : ""}`;
  return `${kind} failed${r.error ? ` (${r.error})` : ""}`;
}

/** Toast fragment; empty string if neither channel reported. */
export function formatDeclineDeliverySummary(
  email?: DeclineChannelOutcome,
  whatsapp?: DeclineChannelOutcome,
): string {
  const parts: string[] = [];
  if (email) parts.push(channelLabel("Email", email));
  if (whatsapp) parts.push(channelLabel("WhatsApp", whatsapp));
  return parts.join(" · ");
}

export const formatMediaReviewDeliverySummary = formatDeclineDeliverySummary;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function noticeEmailHtml(text: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.split("\n").join("<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:15px;line-height:1.55"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">${paragraphs}</div></body></html>`;
}

/** Plain rejection HTML — no invite CTA. */
export function declineEmailHtml(name: string): string {
  return noticeEmailHtml(renderDeclineEmailText(name));
}

/** Plain shortlist HTML — no invite CTA. */
export function approvalEmailHtml(name: string): string {
  return noticeEmailHtml(renderApprovalEmailText(name));
}

/** Incomplete follow-up email HTML — link stays as plain text (no invite CTA button). */
export function followupEmailHtml(v: FollowupTemplateVars, timeZone?: string): string {
  return noticeEmailHtml(renderFollowupEmailText(v, timeZone));
}

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
