import "server-only";
import { createLogger } from "@/lib/logger";
import { sendBrevoEmail, sendResendEmail } from "@/lib/messaging/providers";
import { formatDateTime } from "@/lib/messaging/templates";
import type { Context } from "../context";
import { loadDeliveryConfig } from "../invite-delivery";

type Db = Context["supabase"];
const log = createLogger("round-two/email");

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type MailOutcome = { status: "sent" | "failed" | "skipped"; error?: string };

/** Plain transactional email through the org's configured provider (Resend or Brevo). */
export async function sendRoundTwoEmail(
  db: Db,
  organizationId: string,
  msg: { to: string; toName?: string | null; subject: string; lines: string[]; ctaUrl: string; ctaLabel: string },
): Promise<MailOutcome> {
  const cfg = await loadDeliveryConfig(db, organizationId);
  const text = [...msg.lines, "", `${msg.ctaLabel}: ${msg.ctaUrl}`].join("\n");
  const link = esc(msg.ctaUrl);
  const html =
    msg.lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("") +
    `<p style="margin:24px 0"><a href="${link}" style="background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${esc(msg.ctaLabel)}</a></p>` +
    `<p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all">Or copy this link: ${link}</p>`;
  const provider = cfg.defaultEmailProvider === "brevo" && cfg.brevo ? "brevo" : cfg.resend ? "resend" : cfg.brevo ? "brevo" : null;
  if (!provider) return { status: "skipped", error: "No email provider configured" };
  try {
    const r =
      provider === "brevo" && cfg.brevo
        ? await sendBrevoEmail({
            apiKey: cfg.brevo.apiKey,
            fromEmail: cfg.brevo.fromEmail,
            fromName: cfg.brevo.fromName || cfg.organizationName,
            toEmail: msg.to,
            toName: msg.toName ?? undefined,
            replyTo: cfg.brevo.replyTo,
            subject: msg.subject,
            html,
            text,
          })
        : await sendResendEmail({
            apiKey: cfg.resend!.apiKey,
            from: cfg.resend!.from,
            replyTo: cfg.resend!.replyTo,
            to: msg.to,
            subject: msg.subject,
            html,
            text,
          });
    return r.ok ? { status: "sent" } : { status: "failed", error: r.error };
  } catch (err) {
    log.error("send failed", err instanceof Error ? err.message : err);
    return { status: "failed", error: err instanceof Error ? err.message : "Send failed" };
  }
}

export function scheduleLine(scheduledAt: string | null, durationMin: number): string {
  return scheduledAt
    ? `Scheduled for ${formatDateTime(scheduledAt)} (${durationMin} minutes).`
    : `Planned length: ${durationMin} minutes.`;
}
