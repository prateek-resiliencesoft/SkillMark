"use client";

import type { ErrorCategory, ErrorSeverity } from "@/lib/session-error-log";
import { redactSecrets, sanitizeContext } from "@/lib/session-error-log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recent = new Map<string, number>();

/**
 * Fire-and-forget report to the session's Error Log (tRPC session.logClientError).
 * Deduped per message for 5s; never throws.
 */
export function reportSessionError(
  sessionId: string | null | undefined,
  e: { category: ErrorCategory; message: string; severity?: ErrorSeverity; status?: number; code?: string; context?: Record<string, unknown> },
): void {
  try {
    if (!sessionId || !UUID_RE.test(sessionId) || typeof window === "undefined") return;
    const message = redactSecrets(e.message || "Unknown error", 1000);
    const dedupeKey = `${sessionId}|${e.category}|${message}`;
    const now = Date.now();
    if ((recent.get(dedupeKey) ?? 0) > now - 5000) return;
    recent.set(dedupeKey, now);
    if (recent.size > 200) recent.clear();
    const json = {
      sessionId,
      category: e.category,
      severity: e.severity ?? "error",
      message,
      ...(typeof e.status === "number" ? { status: e.status } : {}),
      ...(e.code ? { code: e.code.slice(0, 64) } : {}),
      context: sanitizeContext({ ...(e.context ?? {}), page: window.location.pathname }),
    };
    void fetch("/api/trpc/session.logClientError", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never break the interview */
  }
}
