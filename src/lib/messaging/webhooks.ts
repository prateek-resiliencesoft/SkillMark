import crypto from "node:crypto";
import { createLogger } from "@/lib/logger";
import { safeFetch, UnsafeUrlError } from "@/lib/network-security";

const log = createLogger("messaging/webhooks");

export type WebhookEventName =
  | "candidate.invited"
  | "session.started"
  | "session.completed";

export interface WebhookPayload<T = Record<string, unknown>> {
  event: WebhookEventName;
  timestamp: string;
  organizationId: string;
  data: T;
}

export function computeWebhookSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = computeWebhookSignature(payload, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function dispatchOutboundWebhook(opts: {
  url?: string | null;
  secret?: string | null;
  event: WebhookEventName;
  organizationId: string;
  data: Record<string, unknown>;
  subscribedEvents?: string[] | null;
}): Promise<{ ok: boolean; status?: number; error?: string; skipped?: boolean }> {
  if (!opts.url) return { ok: true, skipped: true };

  // Check event subscription if specified
  if (opts.subscribedEvents && opts.subscribedEvents.length > 0) {
    if (!opts.subscribedEvents.includes(opts.event)) {
      return { ok: true, skipped: true };
    }
  }

  const payload: WebhookPayload = {
    event: opts.event,
    timestamp: new Date().toISOString(),
    organizationId: opts.organizationId,
    data: opts.data,
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-RSI-Event": opts.event,
  };

  if (opts.secret) {
    headers["X-RSI-Signature"] = computeWebhookSignature(body, opts.secret);
  }

  try {
    const res = await safeFetch(opts.url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      maxBytes: 64 * 1024,
      timeoutMs: 10_000,
    });
    await res.body?.cancel().catch(() => {});

    if (!res.ok) {
      log.warn(`Outbound webhook to ${opts.url} returned HTTP ${res.status}`);
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Outbound webhook dispatch failed";
    log.warn(`Outbound webhook dispatch to ${opts.url} failed: ${msg}`);
    if (err instanceof UnsafeUrlError) {
      return { ok: false, error: "Webhook URL must be a public https:// address without redirects" };
    }
    return { ok: false, error: "Webhook request failed" };
  }
}
