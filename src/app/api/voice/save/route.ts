import { createLogger } from "@/lib/logger";
import { generateSessionSummary } from "@/lib/session-summary";
import { scheduleSessionReport } from "@/lib/session-report-server";
import { REPORT_DELAY_AFTER_COMPLETE_MS } from "@/lib/session-report-policy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifySessionCompleted } from "@/server/completion-notify";
import { finalizeRecordingParts } from "@/lib/recording-parts-server";
import { interviewReachedClosing } from "@/lib/session-link-server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { CANDIDATE_SESSION_GATE_COLUMNS, gateCandidateSession, isSessionId, rejectCrossSiteRequest } from "@/lib/session-access";
import {
  gateVoiceSave,
  handleVoiceSave,
  messageRowId,
  type CompletionSession,
  type ProgressSession,
  type VoiceSaveOps,
  type VoiceSavePayload,
  type VoiceSaveSessionGate,
} from "./logic";

const log = createLogger("api/voice/save");
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const voiceSaveOps: VoiceSaveOps = {
  scheduleReport(sessionId, { force }) {
    // Short delay so the final transcript batch (disconnect flush) lands first.
    scheduleSessionReport(sessionId, "completed", REPORT_DELAY_AFTER_COMPLETE_MS, { force });
  },
  interviewFinished: interviewReachedClosing,
  onCompleted(sessionId) {
    void notifySessionCompleted(supabaseAdmin, sessionId);
    // Fallback: if the browser never linked a recording (closed tab, slow final
    // upload), build it from the parts uploaded during the interview. Delayed so
    // the browser's own finalize/upload normally wins.
    scheduleRecordingFallback(sessionId);
  },
  async insertMessages(sessionId, messages) {
    // Upsert on the client's line id, ignoring ones already stored: a retry or
    // tab-close beacon can resend lines without duplicating them. Errors throw
    // so the client keeps the lines and sends them again.
    const { error } = await supabaseAdmin.from("messages").upsert(
      messages.map((m, i) => {
        const clientTs = m.timestamp ? new Date(m.timestamp) : null;
        const tsValid = clientTs && !Number.isNaN(clientTs.getTime());
        // Tiny offset from seq so same-ms batches stay stable even if DB collapses equals.
        const timestamp = tsValid
          ? new Date(clientTs.getTime() + (typeof m.seq === "number" ? m.seq : i)).toISOString()
          : undefined;
        return {
          id: messageRowId(m.id, randomUUID),
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
      { onConflict: "id", ignoreDuplicates: true, defaultToNull: false },
    );
    if (error) throw new Error(`messages insert failed: ${error.message}`);
  },
  async loadSessionForCompletion(sessionId) {
    const { data, error } = await supabaseAdmin
      .from("sessions")
      .select(
        `*, interview:interviews!inner(title, objective, language, userId, projectId, assessmentCriteria, questions(text, order, type), project:projects(organizationId))`,
      )
      .eq("id", sessionId)
      .order("order", {
        referencedTable: "interviews.questions",
        ascending: true,
      })
      .maybeSingle();
    if (data) return data as CompletionSession;
    if (error) log.error(`Completion load (with interview) failed for ${sessionId}: ${error.message}`);
    // Fallback: the status write must never depend on the interview join.
    const { data: bare } = await supabaseAdmin
      .from("sessions")
      .select("status, startedAt")
      .eq("id", sessionId)
      .maybeSingle();
    if (!bare) return null;
    return {
      status: bare.status as string,
      startedAt: bare.startedAt as string,
      interview: {
        title: "",
        objective: null,
        language: "en",
        userId: "",
        projectId: "",
        assessmentCriteria: null,
        questions: [],
      },
    };
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
    const { error } = await supabaseAdmin.from("sessions").update(payload).eq("id", sessionId);
    if (!error) return;
    // Optional columns (endReason) missing on an older DB: retry the core write.
    if ("endReason" in payload && /endReason|42703|PGRST204/.test(`${error.code} ${error.message}`)) {
      const { endReason: _drop, ...rest } = payload;
      void _drop;
      const retry = await supabaseAdmin.from("sessions").update(rest).eq("id", sessionId);
      if (!retry.error) return;
      throw new Error(`Session update failed: ${retry.error.message}`);
    }
    throw new Error(`Session update failed: ${error.message}`);
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
  // Also receives sendBeacon posts on tab close (JSON Blob → application/json).
  const refused = rejectCrossSiteRequest(req, { json: true });
  if (refused) return refused;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let payload: VoiceSavePayload;
  try {
    payload = (JSON.parse(raw) ?? {}) as VoiceSavePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (isSessionId(payload.sessionId)) {
    const limited = checkRateLimit(`voice:save:${payload.sessionId}`, 120);
    if (limited) return limited;
  }

  const gate = await gateCandidateSession(req, payload.sessionId, `${CANDIDATE_SESSION_GATE_COLUMNS}, modeUsed, startedAt, createdAt`);
  if (!gate.ok) return gate.response;
  const allowed = gateVoiceSave(payload, gate.session as VoiceSaveSessionGate, { inviteExpiresAt: gate.invite?.expiresAt });
  if (!allowed.ok) return NextResponse.json(allowed.body, { status: allowed.status });

  const result = await handleVoiceSave(allowed.payload, voiceSaveOps);
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
