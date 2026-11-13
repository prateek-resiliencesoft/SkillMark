import { createLogger } from "@/lib/logger";
import { generateSessionSummary } from "@/lib/session-summary";
import { scheduleSessionReport } from "@/lib/session-report-server";
import { REPORT_DELAY_AFTER_COMPLETE_MS } from "@/lib/session-report-policy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifySessionCompleted } from "@/server/completion-notify";
import { finalizeRecordingParts } from "@/lib/recording-parts-server";
import { NextResponse } from "next/server";
import { handleVoiceSave, type CompletionSession, type ProgressSession, type VoiceSaveOps, type VoiceSavePayload } from "./logic";

const log = createLogger("api/voice/save");
const voiceSaveOps: VoiceSaveOps = {
  scheduleReport(sessionId, { force }) {
    // Short delay so the final transcript batch (disconnect flush) lands first.
    scheduleSessionReport(sessionId, "completed", REPORT_DELAY_AFTER_COMPLETE_MS, { force });
  },
  onCompleted(sessionId) {
    void notifySessionCompleted(supabaseAdmin, sessionId);
    // Fallback: if the browser never linked a recording (closed tab, slow final
    // upload), build it from the parts uploaded during the interview. Delayed so
    // the browser's own finalize/upload normally wins.
    scheduleRecordingFallback(sessionId);
  },
  async insertMessages(sessionId, messages) {
    await supabaseAdmin.from("messages").insert(
      messages.map((m, i) => {
        const clientTs = m.timestamp ? new Date(m.timestamp) : null;
        const tsValid = clientTs && !Number.isNaN(clientTs.getTime());
        // Tiny offset from seq so same-ms batches stay stable even if DB collapses equals.
        const timestamp = tsValid
          ? new Date(clientTs.getTime() + (typeof m.seq === "number" ? m.seq : i)).toISOString()
          : undefined;
        return {
          sessionId,
          role: m.role === "user" ? ("USER" as const) : ("ASSISTANT" as const),
          content: m.content,
          contentType: "TEXT" as const,
          questionId: m.questionId || null,
          wordCount: m.content.split(/\s+/).length,
          transcription: m.source === "chat" ? "chat" : null,
          ...(timestamp ? { timestamp } : {}),
        };
      }),
    );
  },
  async loadSessionForCompletion(sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select(
        `*, interview:interviews!inner(title, objective, language, userId, projectId, assessmentCriteria, questions(text, order, type), project:projects(organizationId))`,
      )
      .eq("id", sessionId)
      .order("order", {
        referencedTable: "interviews.questions",
        ascending: true,
      })
      .single();

    return (data as CompletionSession | null) ?? null;
  },
  async loadLastMessage(sessionId) {
    const { data } = await supabaseAdmin
      .from("messages")
      .select("role, content")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { role: string; content: string } | null) ?? null;
  },
  async loadFirstMessageTimestamp(sessionId) {
    const { data } = await supabaseAdmin
      .from("messages")
      .select("timestamp")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: true })
      .limit(1)
      .single();

    return (data?.timestamp as string | undefined) ?? null;
  },
  async loadSessionForProgress(sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select(`*, interview:interviews!inner(questions(*))`)
      .eq("id", sessionId)
      .order("order", {
        referencedTable: "interviews.questions",
        ascending: true,
      })
      .single();

    return (data as ProgressSession | null) ?? null;
  },
  async updateSession(sessionId, payload) {
    await supabaseAdmin.from("sessions").update(payload).eq("id", sessionId);
  },
  generateSummary,
  log,
  now: () => new Date(),
};

/**
 * POST /api/voice/save
 * Save voice interview messages, optionally complete the session,
 * and fire-and-forget an AI summary/analysis so the interviewee isn't blocked.
 */
export async function POST(req: Request) {
  // Also receives sendBeacon posts on tab close; parse leniently.
  const payload = ((await req.json().catch(() => null)) ?? {}) as VoiceSavePayload;
  const result = await handleVoiceSave(payload, voiceSaveOps);
  return NextResponse.json(result.body, { status: result.status });
}

async function generateSummary(
  ...args: Parameters<typeof generateSessionSummary>
): Promise<void> {
  try {
    await generateSessionSummary(...args);
  } catch (error) {
    log.error("Summary generation failed:", error);
  }
}

function scheduleRecordingFallback(sessionId: string) {
  setTimeout(() => {
    void finalizeRecordingParts(sessionId, { onlyIfMissing: true, deleteParts: false }).catch((err) =>
      log.error("Recording fallback finalize failed:", err),
    );
  }, 45_000);
}
