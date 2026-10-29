/**
 * Outbound delivery: Resend (email) and ResilioHub (WhatsApp template).
 * Both are plain fetch calls — no SDK needed.
 */
import "server-only";

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendResendEmail(opts: {
  apiKey: string;
  from: string;
  replyTo?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey && { "Idempotency-Key": opts.idempotencyKey }),
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.replyTo && { reply_to: opts.replyTo }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `Resend HTTP ${res.status}` };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Resend request failed" };
  }
}

export async function sendBrevoEmail(opts: {
  apiKey: string;
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  toName?: string | null;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": opts.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: opts.fromEmail,
          name: opts.fromName || undefined,
        },
        to: [
          {
            email: opts.toEmail,
            name: opts.toName || undefined,
          },
        ],
        subject: opts.subject,
        htmlContent: opts.html,
        textContent: opts.text,
        ...(opts.replyTo && { replyTo: { email: opts.replyTo } }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messageId?: string;
      message?: string;
      code?: string;
    };
    if (!res.ok) {
      return { ok: false, error: json.message ?? `Brevo HTTP ${res.status}` };
    }
    return { ok: true, id: json.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Brevo request failed" };
  }
}

export const RESILIO_DEFAULT_BASE_URL = "https://resiliohub.com";

/** POST /api/v1/send_templet — approved Meta template via the client's WABA. */
export async function sendResilioTemplate(opts: {
  apiKey: string;
  baseUrl?: string | null;
  to: string;
  templateName: string;
  bodyVariables: string[];
}): Promise<SendResult> {
  const base = (opts.baseUrl || RESILIO_DEFAULT_BASE_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/v1/send_templet`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sendTo: opts.to.replace(/[^\d+]/g, ""),
        templetName: opts.templateName,
        body_variables: opts.bodyVariables,
        enableLog: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      metaResponse?: { messages?: { id?: string }[]; error?: { message?: string } };
    };
    // v1 returns HTTP 200 with success=false on validation/Meta errors.
    if (!res.ok || json.success === false) {
      return { ok: false, error: json.metaResponse?.error?.message ?? json.message ?? `ResilioHub HTTP ${res.status}` };
    }
    return { ok: true, id: json.metaResponse?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ResilioHub request failed" };
  }
}
