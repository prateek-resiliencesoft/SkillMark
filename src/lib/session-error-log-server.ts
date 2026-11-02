/**
 * Server-only writer for per-session error logs. Best-effort: never throws,
 * so logging can't break the interview it is describing.
 */
import { createLogger } from "@/lib/logger";
import { sanitizeContext, redactSecrets, type SessionErrorEntry } from "@/lib/session-error-log";

const log = createLogger("session-error-log");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordSessionErrors(entries: SessionErrorEntry[]): Promise<void> {
  const rows = entries
    .filter((e) => e.sessionId && UUID_RE.test(e.sessionId))
    .map((e) => ({
      sessionId: e.sessionId,
      category: e.category,
      severity: e.severity,
      source: e.source.slice(0, 100),
      message: redactSecrets(e.message, 1000),
      status: e.status ?? null,
      code: e.code ? String(e.code).slice(0, 64) : null,
      context: sanitizeContext(e.context ?? {}),
    }));
  if (!rows.length) return;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { error } = await supabaseAdmin.from("session_error_logs").insert(rows);
    if (error) log.warn(`Could not store session error log: ${error.message}`);
  } catch (err) {
    log.warn(`Could not store session error log: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function recordSessionError(entry: SessionErrorEntry): Promise<void> {
  return recordSessionErrors([entry]);
}

type FailoverLike = {
  failures?: { provider: string; source: "org" | "env"; keyIndex: number; status?: number; message: string; at: string }[];
  served?: { provider: string; source: "org" | "env"; keyIndex: number; failover: boolean } | null;
};

/**
 * Log the per-key failures of one AI call (from FailoverProvider) plus the
 * final error if the call failed outright. Records key SOURCE only (org/env).
 */
export async function recordAiCallErrors(opts: {
  sessionId?: string | null;
  provider: unknown;
  source: string;
  category?: "ai" | "report" | "tts_stt";
  finalError?: unknown;
}): Promise<void> {
  const { sessionId, provider, source } = opts;
  if (!sessionId) return;
  const { entryFromError } = await import("@/lib/session-error-log");
  const p = (provider ?? {}) as FailoverLike;
  const served = p.served ?? null;
  const entries: SessionErrorEntry[] = (p.failures ?? []).map((f, i, all) => {
    const recovered = !!served || i < all.length - 1;
    const err = Object.assign(new Error(f.message), { status: f.status });
    return entryFromError(sessionId, err, {
      category: opts.category ?? "ai",
      source,
      severity: recovered ? "warning" : "error",
      context: {
        provider: f.provider,
        keySource: f.source,
        keySlot: f.keyIndex + 1,
        failover: recovered,
        recoveredBy: served ? `${served.provider} (${served.source} key #${served.keyIndex + 1})` : null,
      },
    });
  });
  if (opts.finalError) {
    entries.push(
      entryFromError(sessionId, opts.finalError, {
        category: opts.category ?? "ai",
        source,
        severity: "critical",
        context: { stage: "final", keysTried: (p.failures ?? []).length },
      }),
    );
  }
  await recordSessionErrors(entries);
}
