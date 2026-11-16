/**
 * Rebuild a session's candidate transcript from its stored audio recording.
 *
 * Used when the live voice AI never received the candidate's mic audio (so no
 * USER lines were saved) but the browser recording still has their answers.
 * Server-only.
 *
 * - Interviewer (ASSISTANT) rows are the source of truth and are never touched.
 * - Only speech the model labels "candidate" becomes USER rows; anything that
 *   repeats an interviewer line (the AI voice is on the recording) is dropped.
 * - Voice USER rows are replaced (re-running replaces, never stacks); typed chat answers are kept.
 * - Replaced USER rows are backed up as JSON next to the recording first.
 * - New rows are marked transcription = 'recording'.
 * - The report is regenerated afterwards.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile as readLocalFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractJson } from "@/lib/ai/extract-json";
import { loadOrgAiCredentials } from "@/lib/ai/credentials";
import { createLogger } from "@/lib/logger";
import { recordSessionError } from "@/lib/session-error-log-server";
import { generateSummaryForSession, type SummaryOutcome } from "@/lib/session-summary";
import { readFile, storage } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { objectPathFromSignedUrl, pathBelongsToSession } from "@/lib/tenant-storage";
import { planTranscriptReplacement, type StoredMessage, type TranscribedTurn } from "./align";

const log = createLogger("retranscribe");

const GEMINI_API = "https://generativelanguage.googleapis.com";
/** Inline audio limit (request max is 20MB; base64 adds ~33%). Bigger files use the Files API. */
const INLINE_MAX_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 280_000;

export class RetranscribeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type RetranscribeResult = {
  candidateLines: number;
  candidateWords: number;
  replacedLines: number;
  backupPath: string | null;
  model: string;
  summary: SummaryOutcome | "failed";
};

type DbMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  contentType: string;
  timestamp: string;
  questionId: string | null;
  transcription: string | null;
};

function guessMime(contentType: string, objectPath: string): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct.startsWith("audio/") || ct.startsWith("video/")) return ct;
  const ext = path.extname(objectPath).toLowerCase();
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".mp3") return "audio/mp3";
  if (ext === ".wav") return "audio/wav";
  return "audio/webm";
}

/** Gemini lists audio/mp4 and audio/webm inconsistently; the video types carry the same audio track. */
function mimeFallbacks(mime: string): string[] {
  const out = [mime];
  if (mime === "audio/mp4") out.push("video/mp4", "audio/aac");
  if (mime === "audio/webm") out.push("video/webm", "audio/ogg");
  return out;
}

function geminiModels(): string[] {
  const list = [
    process.env.GEMINI_TRANSCRIBE_MODEL?.trim(),
    process.env.GEMINI_MODEL?.trim(),
    "gemini-3.5-flash",
    "gemini-3.8-flash",
  ].filter((m): m is string => !!m);
  return Array.from(new Set(list));
}

let ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable == null) {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

/**
 * Browser recordings are often Opus inside MP4/WebM, which Gemini does not
 * always decode. When ffmpeg is available, convert to small mono MP3 first.
 */
export async function normalizeAudioForTranscription(
  audio: Buffer,
  mime: string,
): Promise<{ audio: Buffer; mime: string; converted: boolean }> {
  if (!hasFfmpeg()) return { audio, mime, converted: false };
  const dir = await mkdtemp(path.join(os.tmpdir(), "retranscribe-"));
  try {
    const input = path.join(dir, "in");
    const output = path.join(dir, "out.mp3");
    await writeFile(input, audio);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", output],
        { timeout: 120_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const out = await readLocalFile(output);
    if (!out.length) throw new Error("empty output");
    return { audio: out, mime: "audio/mp3", converted: true };
  } catch (err) {
    log.warn(`ffmpeg conversion failed, sending original audio: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    return { audio, mime, converted: false };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function uploadToGeminiFiles(apiKey: string, data: Buffer, mime: string): Promise<{ uri: string; name: string }> {
  const start = await fetch(`${GEMINI_API}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "interview-recording" } }),
    signal: AbortSignal.timeout(60_000),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) {
    throw new Error(`Gemini file upload start failed (${start.status}): ${(await start.text()).slice(0, 200)}`);
  }
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(data.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(180_000),
  });
  if (!up.ok) throw new Error(`Gemini file upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  const json = (await up.json()) as { file?: { uri?: string; name?: string; state?: string } };
  const file = json.file;
  if (!file?.uri || !file.name) throw new Error("Gemini file upload returned no file uri");
  // Audio usually becomes ACTIVE immediately; poll briefly if still processing.
  let state = file.state;
  for (let i = 0; i < 30 && state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${GEMINI_API}/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
    state = ((await res.json()) as { state?: string }).state;
  }
  if (state && state !== "ACTIVE") throw new Error(`Gemini file not ready (state=${state})`);
  return { uri: file.uri, name: file.name };
}

async function deleteGeminiFile(apiKey: string, name: string) {
  await fetch(`${GEMINI_API}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }).catch(() => undefined);
}

export function buildPrompt(interviewerLines: string[], language: string | null | undefined): string {
  const numbered = interviewerLines
    .map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  return `This is the audio recording of a job interview. It contains two voices:
- INTERVIEWER: a synthetic AI voice that asks the questions. Its words are listed below.
- CANDIDATE: the human being interviewed, speaking into their microphone.
The interviewer's voice is mixed into the recording and can also be picked up again through the candidate's speakers (a quieter echo). Any speech that matches an interviewer line below is the INTERVIEWER, never the candidate.

Transcribe the whole recording as speaker turns, in order.

Rules:
- Write exactly what was said. Never invent, summarise, or fix content. Use "[inaudible]" for words you cannot make out.
- Keep the language as spoken${language ? ` (interview language: ${language})` : ""}.
- speaker is exactly "interviewer" or "candidate". Never put interviewer words inside a candidate turn; split the turn instead.
- startSec / endSec are when the turn starts and ends, in seconds from the start of the recording.
- For every interviewer turn set afterLine to the number of the line below it matches (0 if none).
- For every candidate turn set afterLine to the number of the most recent interviewer line spoken before it (0 if the candidate speaks before line 1).
- Skip silence, background noise, typing, and echoes. If the candidate never speaks, return no candidate turns.

Interviewer lines already saved for this interview:
${numbered || "(none)"}

Return JSON only: {"turns":[{"speaker":"interviewer"|"candidate","startSec":number,"endSec":number,"afterLine":number,"text":string}]}`;
}

async function callGemini(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  audio: { inline: string; mime: string } | { uri: string; mime: string };
}): Promise<string> {
  const audioPart =
    "inline" in opts.audio
      ? { inline_data: { mime_type: opts.audio.mime, data: opts.audio.inline } }
      : { file_data: { mime_type: opts.audio.mime, file_uri: opts.audio.uri } };
  const res = await fetch(`${GEMINI_API}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": opts.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [audioPart, { text: opts.prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32768,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const err = new Error(`Gemini ${res.status}: ${body}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (cand?.finishReason === "MAX_TOKENS") throw new Error("Transcript too long for one pass (MAX_TOKENS)");
  if (!text.trim()) throw new Error(`Gemini returned no transcript (finishReason=${cand?.finishReason ?? "none"})`);
  return text;
}

export async function transcribeAudio(
  apiKeys: string[],
  audio: Buffer,
  mime: string,
  prompt: string,
  opts: { forceUpload?: boolean } = {},
): Promise<{ turns: TranscribedTurn[]; model: string }> {
  let lastErr: unknown;
  keys: for (const apiKey of apiKeys) {
    models: for (const model of geminiModels()) {
      for (const m of mimeFallbacks(mime)) {
        let uploaded: { uri: string; name: string } | null = null;
        try {
          let audioRef: { inline: string; mime: string } | { uri: string; mime: string };
          if (audio.length <= INLINE_MAX_BYTES && !opts.forceUpload) {
            audioRef = { inline: audio.toString("base64"), mime: m };
          } else {
            uploaded = await uploadToGeminiFiles(apiKey, audio, m);
            audioRef = { uri: uploaded.uri, mime: m };
          }
          let raw: string;
          try {
            raw = await callGemini({ apiKey, model, prompt, audio: audioRef });
          } catch (err) {
            const st = (err as { status?: number }).status;
            if (st !== 503 && st !== 429) throw err;
            await new Promise((r) => setTimeout(r, 5000)); // brief overload / per-minute limit
            raw = await callGemini({ apiKey, model, prompt, audio: audioRef });
          }
          const parsed = extractJson<{ turns?: TranscribedTurn[] }>(raw);
          const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
          // The interviewer's voice is always on the recording; if the model heard
          // nobody, it couldn't decode this format — try the next mime type.
          if (!turns.some((t) => String(t.speaker ?? "").toLowerCase() === "interviewer")) {
            lastErr = new Error(`No speech decoded from the recording (model=${model}, mime=${m})`);
            log.warn((lastErr as Error).message);
            continue;
          }
          return { turns, model };
        } catch (err) {
          lastErr = err;
          const status = (err as { status?: number }).status;
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`Transcribe attempt failed (model=${model}, mime=${m}): ${msg.slice(0, 200)}`);
          if (status === 401 || status === 403 || status === 429) continue keys; // bad key / quota
          if (status === 400) continue; // maybe the mime type — try the next one
          continue models; // unknown model, server error, timeout, bad JSON
        } finally {
          if (uploaded) void deleteGeminiFile(apiKey, uploaded.name);
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Transcription failed");
}

const running = new Set<string>();

export async function retranscribeSessionFromRecording(
  sessionId: string,
  opts: { source: string },
): Promise<RetranscribeResult> {
  if (running.has(sessionId)) {
    throw new RetranscribeError("A re-transcribe for this session is already running. Try again in a few minutes.", 409);
  }
  running.add(sessionId);
  try {
    return await retranscribeInner(sessionId, opts);
  } finally {
    running.delete(sessionId);
  }
}

async function retranscribeInner(sessionId: string, opts: { source: string }): Promise<RetranscribeResult> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select(
      `id, audioRecordingUrl, mediaClearedAt, interview:interviews!inner(language, project:projects!inner(organizationId))`,
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new RetranscribeError("Session not found", 404);
  const s = session as unknown as {
    audioRecordingUrl?: string | null;
    mediaClearedAt?: string | null;
    interview: { language?: string | null; project: { organizationId: string } };
  };
  const organizationId = s.interview.project.organizationId;
  if (!s.audioRecordingUrl || s.mediaClearedAt) {
    throw new RetranscribeError("This session has no recording to transcribe.");
  }
  const objectPath =
    objectPathFromSignedUrl("recordings", s.audioRecordingUrl) ?? s.audioRecordingUrl.split("?")[0];
  if (!pathBelongsToSession(objectPath, sessionId, organizationId)) {
    throw new RetranscribeError("Recording path does not belong to this session.", 403);
  }

  const creds = await loadOrgAiCredentials(supabaseAdmin, organizationId);
  const apiKeys = creds.gemini.apiKeys;
  if (!apiKeys.length) throw new RetranscribeError("No Gemini API key configured for transcription.", 503);

  const { data: rawAudio, contentType } = await readFile("recordings", objectPath);
  if (!rawAudio.length) throw new RetranscribeError("The recording file is empty.");
  const prepared = await normalizeAudioForTranscription(rawAudio, guessMime(contentType, objectPath));
  const { audio, mime } = prepared;

  const { data: rows } = await supabaseAdmin
    .from("messages")
    .select("id, role, content, contentType, timestamp, questionId, transcription")
    .eq("sessionId", sessionId)
    .eq("contentType", "TEXT")
    .order("timestamp", { ascending: true });
  const messages = (rows ?? []) as DbMessage[];
  const assistant = messages.filter((m) => m.role === "ASSISTANT");

  log.info(
    `Transcribing recording for ${sessionId} (${Math.round(audio.length / 1024)} KB, ${mime}${prepared.converted ? ", converted with ffmpeg" : ""})`,
  );
  const { turns, model } = await transcribeAudio(
    apiKeys,
    audio,
    mime,
    buildPrompt(assistant.map((m) => m.content), s.interview.language),
  );

  // Re-read right before writing so a run started meanwhile can't leave stacked rows.
  const { data: freshRows } = await supabaseAdmin
    .from("messages")
    .select("id, role, content, contentType, timestamp, questionId, transcription")
    .eq("sessionId", sessionId)
    .eq("contentType", "TEXT")
    .order("timestamp", { ascending: true });
  const plan = planTranscriptReplacement((freshRows ?? messages) as StoredMessage[], turns);
  const aligned = plan.insert;
  const replaceable = plan.replaced;
  if (aligned.length === 0) {
    throw new RetranscribeError("No candidate speech was found in the recording. Nothing was changed.", 422);
  }

  // Back up the rows we are about to replace (none for a session with zero answers).
  let backupPath: string | null = null;
  if (replaceable.length > 0) {
    backupPath = path.posix.join(path.posix.dirname(objectPath), `transcript-backup-${Date.now()}.json`);
    const { error } = await storage
      .from("recordings")
      .upload(backupPath, Buffer.from(JSON.stringify({ sessionId, savedAt: new Date().toISOString(), messages: replaceable }, null, 2)), {
        contentType: "application/json",
      });
    if (error) throw new RetranscribeError(`Could not back up the old transcript: ${error.message}`, 500);
  }

  // Insert the new candidate lines first, then remove the old ones by id, so a
  // failed insert never loses the old transcript and a re-run never stacks lines.
  const { error: insErr } = await supabaseAdmin.from("messages").insert(
    aligned.map((t) => ({
      sessionId,
      role: "USER" as const,
      content: t.text,
      contentType: "TEXT" as const,
      questionId: t.questionId,
      wordCount: t.text.split(/\s+/).length,
      transcription: "recording",
      timestamp: t.timestamp,
    })),
  );
  if (insErr) throw new RetranscribeError(`Could not save the new transcript: ${insErr.message}`, 500);
  if (plan.deleteIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("sessionId", sessionId)
      .eq("role", "USER")
      .in("id", plan.deleteIds);
    if (delErr) throw new RetranscribeError(`Could not replace the old transcript: ${delErr.message}`, 500);
  }

  const candidateWords = aligned.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  void recordSessionError({
    sessionId,
    category: "tts_stt",
    severity: "info",
    source: opts.source,
    message: `Transcript rebuilt from recording: ${aligned.length} candidate lines (${candidateWords} words), replaced ${replaceable.length}.`,
    context: { stage: "retranscribe", model, backupPath, mime },
  });

  let summary: RetranscribeResult["summary"] = "failed";
  try {
    summary = await generateSummaryForSession(sessionId);
  } catch (err) {
    log.error("Report regeneration after re-transcribe failed:", err);
  }

  return {
    candidateLines: aligned.length,
    candidateWords,
    replacedLines: replaceable.length,
    backupPath,
    model,
    summary,
  };
}
