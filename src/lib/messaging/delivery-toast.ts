/** Summarize multi-channel invite send results for toasts. */

export type ChannelDelivery = { status: string; error?: string };

export type DeliveryToast = {
  title: string;
  description: string;
  /** Only true when nothing was sent and at least one channel failed. */
  destructive: boolean;
  sent: number;
  failed: number;
  skipped: number;
};

export function summarizeDelivery(
  d: { email?: ChannelDelivery; whatsapp?: ChannelDelivery } | undefined,
  opts?: { verb?: "sent" | "resent"; newLink?: boolean },
): DeliveryToast {
  const verb = opts?.verb ?? "sent";
  const parts: string[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const [ch, label] of [
    ["whatsapp", "WhatsApp"],
    ["email", "Email"],
  ] as const) {
    const r = d?.[ch];
    if (!r) continue;
    if (r.status === "sent") {
      sent += 1;
      parts.push(`${label}: sent`);
    } else if (r.status === "skipped") {
      skipped += 1;
      parts.push(`${label}: skipped${r.error ? ` (${r.error})` : ""}`);
    } else {
      failed += 1;
      parts.push(`${label}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
    }
  }

  const description = parts.join(" · ") || "Nothing to send";

  if (sent > 0 && failed === 0) {
    return {
      title: opts?.newLink ? "New link sent" : verb === "resent" ? "Invite resent" : "Invite link sent",
      description,
      destructive: false,
      sent,
      failed,
      skipped,
    };
  }
  if (sent > 0 && failed > 0) {
    return {
      title: opts?.newLink ? "New link created — partially sent" : "Partially sent",
      description,
      destructive: false,
      sent,
      failed,
      skipped,
    };
  }
  if (failed > 0) {
    return {
      title: opts?.newLink ? "New link created, but send failed" : "Send failed",
      description,
      destructive: true,
      sent,
      failed,
      skipped,
    };
  }
  return {
    title: opts?.newLink ? "New link created" : "Nothing sent",
    description: opts?.newLink
      ? "Copy the link to share it with the candidate."
      : description,
    destructive: false,
    sent,
    failed,
    skipped,
  };
}
