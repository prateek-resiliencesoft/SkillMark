/**
 * Best-effort triage enqueue. Never throws to callers — interview/feedback paths stay safe.
 */
import { createLogger } from "@/lib/logger";
import type { TriageEventPayload, TriageSource } from "./types";

const log = createLogger("bug-triage/enqueue");

export async function enqueueTriageEvent(opts: {
  source: TriageSource;
  sourceId: string;
  payload: TriageEventPayload;
}): Promise<void> {
  const sourceId = String(opts.sourceId || "").slice(0, 80);
  if (!sourceId) return;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { error } = await supabaseAdmin.from("triage_events").upsert(
      {
        source: opts.source,
        sourceId,
        payload: opts.payload ?? {},
        status: "pending",
        error: null,
      },
      { onConflict: "source,sourceId", ignoreDuplicates: true },
    );
    if (error) {
      // Unique race or missing table — ignore.
      if (error.code === "23505" || error.code === "42P01") return;
      log.warn(`enqueue failed: ${error.message}`);
    }
  } catch (err) {
    log.warn(`enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function enqueueFeedbackTriage(row: {
  id: string;
  rating: number;
  tags?: string[] | null;
  comment?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
}): Promise<void> {
  const comment = (row.comment ?? "").trim();
  // Rating-only with no comment still enqueued if tags look negative; otherwise skip empty praise.
  if (!comment && !(row.tags?.length) && row.rating >= 4) return;
  await enqueueTriageEvent({
    source: "feedback",
    sourceId: row.id,
    payload: {
      message: comment || null,
      rating: row.rating,
      tags: row.tags ?? [],
      sessionId: row.sessionId ?? null,
      organizationId: row.organizationId ?? null,
      sourceLabel: "candidate_feedback",
    },
  });
}

export async function enqueueErrorLogTriage(
  rows: {
    id?: string | null;
    sessionId: string;
    category: string;
    severity: string;
    source: string;
    message: string;
    signature?: string | null;
  }[],
): Promise<void> {
  for (const r of rows) {
    // Prefer DB id when returned; else signature+session as synthetic id (dedupe soft).
    const sourceId = (r.id && String(r.id)) || `${r.signature ?? "sig"}:${r.sessionId}:${hashShort(r.message)}`;
    await enqueueTriageEvent({
      source: "error_log",
      sourceId: sourceId.slice(0, 80),
      payload: {
        message: r.message,
        category: r.category,
        severityHint: r.severity,
        sourceLabel: r.source,
        sessionId: r.sessionId,
      },
    });
  }
}

function hashShort(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(0, 8);
}
