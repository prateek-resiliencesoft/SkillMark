/**
 * Rebuild a session's candidate transcript from its stored audio recording.
 *
 * Used when the live voice AI never received the candidate's mic audio (so no
 * USER lines were saved) but the browser recording still has their answers.
 * Server-only.
 *
 * Source audio, best first:
 *   1. the candidate-only mic track (`micpart-*` parts): cut at pauses, each clip
 *      transcribed on its own and placed after the interviewer line before it;
 *   2. the mixed recording (interviewer + candidate): Gemini separates the speakers
 *      itself, or other engines get their clips labelled against the saved lines.
 * Engines follow the org's own AI keys (stt-engines.ts): Gemini 3.5 Transcribe,
 * OpenAI gpt-transcribe, Groq Whisper large v3; a short text-model pass then fixes
 * only clear mishearings of names and skills (cleanup.ts).
 *
 * - Interviewer (ASSISTANT) rows are the source of truth and are never touched.
 * - Only speech that is the candidate's becomes USER rows; anything that
 *   repeats an interviewer line (the AI voice is on the recording) is dropped.
 * - Voice USER rows are replaced (re-running replaces, never stacks); typed chat answers are kept.
 * - Replaced USER rows are backed up as JSON next to the recording first.
 * - New rows are marked transcription = 'recording'.
 * - The report is regenerated afterwards.
 */
import { GEMINI_FALLBACK_MODELS, normalizeGeminiModel } from "@/lib/ai/gemini-models";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile as readLocalFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractJson } from "@/lib/ai/extract-json";
import { callJson } from "@/lib/ai/json-call";
import { loadCredsPair } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { recordSessionError } from "@/lib/session-error-log-server";
import { generateSummaryForSession, type SummaryOutcome } from "@/lib/session-summary";
import { readFile, storage } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { objectPathFromSignedUrl, pathBelongsToSession } from "@/lib/tenant-storage";
import {
  diarizeByLines,
  micClipsToTurns,
  planTranscriptReplacement,
  type MicClip,
  type StoredMessage,
  type TranscribedTurn,
} from "./align";
import { cleanupTranscript } from "./cleanup";
import { decodeToWav, ffmpegAvailable as ffmpegInstalled, loadMicRuns } from "./mic-runs-server";
import { describeNoSttReason, selectSttCandidates, sttLanguagesFor } from "./stt-engines";
import { transcribeAudioClips, type PipelineContext } from "./stt-pipeline";
import { buildPromptHint, buildVocabulary } from "./stt-vocab";
import { devanagariToRoman } from "@/lib/transcript/transliterate";

const log = createLogger("retranscribe");

const GEMINI_API = "https://generativelanguage.googleapis.com";
/** Inline audio limit (request max is 20MB; base64 adds ~33%). Bigger files use the Files API. */
const INLINE_MAX_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 280_000;
/** Auto mode keeps the live transcript unless the recording transcript keeps at least this share of its words. */
const AUTO_MIN_WORD_RATIO = 0.6;

const wordCount = (texts: string[]) => texts.reduce((n, t) => n + (t.trim() ? t.trim().split(/\s+/).length : 0), 0);

export function recordingTranscriptKeepsWords(liveTexts: string[], recordingTexts: string[]): boolean {
  return wordCount(recordingTexts) >= wordCount(liveTexts) * AUTO_MIN_WORD_RATIO;
}

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
  summary: SummaryOutcome | "failed" | "skipped";
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
    process.env.GEMINI_TRANSCRIBE_MODEL?.trim() ? normalizeGeminiModel(process.env.GEMINI_TRANSCRIBE_MODEL) : null,
    process.env.GEMINI_MODEL?.trim() ? normalizeGeminiModel(process.env.GEMINI_MODEL) : null,
    ...GEMINI_FALLBACK_MODELS,
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
- Use the interviewer line just before each candidate turn as context to pick the right word when the audio is ambiguous: an answer to "what is your name" is a person's name, an answer about salary or CTC is an amount, an answer about notice period is a duration.
- Candidates are often Indian and speak Indian English. Write Indian names in their common romanised spelling, exactly as pronounced; never swap a name for a different, similar-sounding name. Keep Indian HR and money terms as spoken: LPA (lakhs per annum), lakh, crore, CTC, in-hand, fixed, variable, notice period, serving notice, B.Tech, M.Tech, MCA. "5 LPA" is an amount, never a time like "5 PM".
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

/**
 * `auto`: run by the automatic report. Skips sessions already transcribed from
 * the recording, keeps the live transcript when the recording one would lose
 * words, and leaves the report to the caller.
 */
export async function retranscribeSessionFromRecording(
  sessionId: string,
  opts: { source: string; auto?: boolean },
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

/** Best-effort automatic pass before the report. Never throws; false = live transcript kept. */
export async function refineTranscriptFromRecording(sessionId: string): Promise<boolean> {
  try {
    const r = await retranscribeSessionFromRecording(sessionId, { source: "auto/report", auto: true });
    log.info(`Auto re-transcribed ${sessionId}: ${r.candidateLines} candidate lines (replaced ${r.replacedLines})`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    const status = err instanceof RetranscribeError ? err.status : 0;
    log.info(`Auto re-transcribe skipped for ${sessionId}: ${msg}`);
    // Only "already done" and "nothing recorded" are routine. Anything else (no usable AI key,
    // engine errors, a transcript that lost too many words) used to vanish silently; now it shows
    // in the session's error log so a bad Hindi transcript can be traced.
    if (status !== 409 && !/no recording/i.test(msg)) {
      void recordSessionError({
        sessionId,
        category: "tts_stt",
        severity: "warning",
        source: "auto/report",
        message: `Live transcript kept, recording transcript not used: ${msg}`,
        status: status || null,
        context: { stage: "retranscribe" },
      });
    }
    return false;
  }
}

/** Mic turns lose to the mixed recording when this share of their speech clips could not be transcribed. */
const MIC_MAX_UNTRANSCRIBED_SHARE = 0.3;

const usageLabel = (usage: Record<string, number>) =>
  Object.entries(usage)
    .map(([k, n]) => `${k}×${n}`)
    .join(", ");

function mergeUsage(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
}

/** Interview names and skills the speech models should expect (best-effort, never throws). */
async function loadVocabularySources(sessionId: string, organizationId: string): Promise<{ organizationName: string | null; skills: string[] }> {
  let organizationName: string | null = null;
  let skills: string[] = [];
  try {
    const { data: org } = await supabaseAdmin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    organizationName = (org as { name?: string | null } | null)?.name ?? null;
  } catch {
    /* optional */
  }
  try {
    const { data: sess } = await supabaseAdmin.from("sessions").select("candidateId").eq("id", sessionId).maybeSingle();
    const candidateId = (sess as { candidateId?: string | null } | null)?.candidateId;
    if (candidateId) {
      const { data: c } = await supabaseAdmin.from("candidates").select("skills").eq("id", candidateId).maybeSingle();
      const raw = (c as { skills?: unknown } | null)?.skills;
      if (Array.isArray(raw)) skills = raw.filter((x): x is string => typeof x === "string").slice(0, 40);
    }
  } catch {
    /* optional */
  }
  return { organizationName, skills };
}

async function retranscribeInner(sessionId: string, opts: { source: string; auto?: boolean }): Promise<RetranscribeResult> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select(
      `id, audioRecordingUrl, mediaClearedAt, mediaStoragePrefix, participantName, interview:interviews!inner(title, language, projectId, questions(text, order), project:projects!inner(organizationId))`,
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new RetranscribeError("Session not found", 404);
  const s = session as unknown as {
    audioRecordingUrl?: string | null;
    mediaClearedAt?: string | null;
    mediaStoragePrefix?: string | null;
    participantName?: string | null;
    interview: {
      title?: string | null;
      language?: string | null;
      projectId?: string | null;
      questions?: { text?: string | null; order?: number | null }[] | null;
      project: { organizationId: string };
    };
  };
  const organizationId = s.interview.project.organizationId;
  if (s.mediaClearedAt) throw new RetranscribeError("This session has no recording to transcribe.");
  let objectPath: string | null = null;
  if (s.audioRecordingUrl) {
    objectPath = objectPathFromSignedUrl("recordings", s.audioRecordingUrl) ?? s.audioRecordingUrl.split("?")[0];
    if (
      !pathBelongsToSession(objectPath, sessionId, organizationId, {
        projectId: s.interview.projectId,
        mediaStoragePrefix: s.mediaStoragePrefix,
      })
    ) {
      throw new RetranscribeError("Recording path does not belong to this session.", 403);
    }
  }

  // Engines come from the org's own keys (Settings → AI); env keys are only the platform fallback.
  const { merged, routing } = await loadCredsPair(organizationId);
  const candidates = selectSttCandidates({ merged, routing });
  if (!candidates.length) throw new RetranscribeError(describeNoSttReason(merged), 503);

  // Where this session's recordings live (mic parts sit next to the mixed recording).
  let recordingsDir: string | null = objectPath ? path.posix.dirname(objectPath) : null;
  if (!recordingsDir) {
    const { resolveSessionMediaTarget } = await import("@/lib/recording-parts-server");
    const target = await resolveSessionMediaTarget(sessionId);
    if (target) recordingsDir = `${target.prefix}/recordings`;
  }
  if (!recordingsDir) throw new RetranscribeError("This session has no recording to transcribe.");

  const { data: rows } = await supabaseAdmin
    .from("messages")
    .select("id, role, content, contentType, timestamp, questionId, transcription")
    .eq("sessionId", sessionId)
    .eq("contentType", "TEXT")
    .order("timestamp", { ascending: true });
  const messages = (rows ?? []) as DbMessage[];
  const assistant = messages.filter((m) => m.role === "ASSISTANT");
  if (opts.auto && messages.some((m) => m.role === "USER" && m.transcription === "recording")) {
    throw new RetranscribeError("Already transcribed from the recording.", 409);
  }

  const interviewerLines = assistant.map((m) => m.content);
  const languages = sttLanguagesFor(s.interview.language);
  const extra = await loadVocabularySources(sessionId, organizationId);
  const questionTexts = (s.interview.questions ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((q) => q.text ?? "")
    .filter(Boolean);
  const vocabulary = buildVocabulary({
    candidateName: s.participantName,
    companyName: extra.organizationName,
    interviewTitle: s.interview.title,
    texts: [...questionTexts, ...interviewerLines, extra.skills.join(". ")],
  });
  const ctx: PipelineContext = {
    candidates,
    languages,
    vocabulary,
    promptHint: buildPromptHint(vocabulary, { hindi: languages.hindi }),
  };

  const notes: string[] = [];
  const failures: string[] = [];
  const usage: Record<string, number> = {};
  let turns: TranscribedTurn[] | null = null;
  let source: "mic" | "mixed" = "mixed";

  // 1) Candidate-only mic track: nothing to separate from the interviewer.
  try {
    const mic = await loadMicRuns(recordingsDir, sessionId);
    notes.push(...mic.notes);
    if (mic.runs.length) {
      const clips: MicClip[] = [];
      let segments = 0;
      let missed = 0;
      for (const run of mic.runs) {
        const r = await transcribeAudioClips(run.audio, ctx);
        segments += r.segments;
        missed += r.unTranscribed;
        mergeUsage(usage, r.usage);
        failures.push(...r.failures);
        for (const c of r.clips) {
          clips.push({ text: c.text, startMs: run.runId + c.startSec * 1000, endMs: run.runId + c.endSec * 1000 });
        }
      }
      const micTurns = micClipsToTurns(clips, assistant.map((m) => Date.parse(m.timestamp)));
      if (segments > 0 && missed / segments > MIC_MAX_UNTRANSCRIBED_SHARE) {
        notes.push(`mic-only track dropped: ${missed} of ${segments} clips could not be transcribed`);
      } else if (micTurns.length) {
        turns = micTurns;
        source = "mic";
      } else {
        notes.push("mic-only track had no speech");
      }
    }
  } catch (err) {
    notes.push(`mic-only track failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
  }

  // 2) Mixed recording (interviewer + candidate) with speaker handling.
  let mime = "audio/wav";
  if (!turns) {
    if (!objectPath) {
      throw new RetranscribeError(`No usable recording. ${notes.join("; ")}`.trim(), 422);
    }
    const { data: rawAudio, contentType } = await readFile("recordings", objectPath);
    if (!rawAudio.length) throw new RetranscribeError("The recording file is empty.");
    let engines = candidates;
    if (engines[0]?.engine === "gemini") {
      // Gemini first: its general model separates the speakers itself, using the saved interviewer lines.
      const prepared = await normalizeAudioForTranscription(rawAudio, guessMime(contentType, objectPath));
      mime = prepared.mime;
      log.info(`Transcribing mixed recording for ${sessionId} (${Math.round(prepared.audio.length / 1024)} KB, ${mime})`);
      try {
        const out = await transcribeAudio(
          engines.filter((c) => c.engine === "gemini").map((c) => c.apiKey),
          prepared.audio,
          prepared.mime,
          buildPrompt(interviewerLines, s.interview.language),
        );
        turns = out.turns;
        usage[`gemini:${out.model}`] = 1;
      } catch (err) {
        failures.push(`gemini mixed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
        engines = engines.filter((c) => c.engine !== "gemini");
      }
    }
    if (!turns && engines.length) {
      if (!ffmpegInstalled()) {
        throw new RetranscribeError("ffmpeg is needed to transcribe this recording with the configured speech engine.", 503);
      }
      const wav = await decodeToWav(rawAudio, path.extname(objectPath).slice(1) || "webm");
      const r = await transcribeAudioClips(wav, { ...ctx, candidates: engines });
      mergeUsage(usage, r.usage);
      failures.push(...r.failures);
      if (r.segments > 0 && r.unTranscribed / r.segments > MIC_MAX_UNTRANSCRIBED_SHARE) {
        throw new RetranscribeError(
          `No speech engine could transcribe the recording (${r.unTranscribed} of ${r.segments} clips failed). ${r.failures.slice(0, 2).join("; ")}`.trim(),
          502,
        );
      }
      turns = diarizeByLines(r.clips, interviewerLines);
    }
    if (!turns) {
      throw new RetranscribeError(`No speech engine could transcribe the recording. ${failures.slice(0, 2).join("; ")}`.trim(), 502);
    }
  }
  const model = `${source}: ${usageLabel(usage) || "unknown"}`;

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
  const rawWords = aligned.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  if (opts.auto && !recordingTranscriptKeepsWords(replaceable.map((m) => m.content), aligned.map((t) => t.text))) {
    throw new RetranscribeError(`Recording transcript has only ${rawWords} words; kept the live transcript.`, 422);
  }

  // Roman-script first (Hindi), then a short text-model pass that fixes only clear mishearings of names and skills.
  const romanized = aligned.map((t) => devanagariToRoman(t.text));
  const assistantAt = assistant.map((m) => ({ at: Date.parse(m.timestamp), text: m.content }));
  const questionFor = (iso: string) => {
    const at = Date.parse(iso);
    let q: string | undefined;
    for (const a of assistantAt) if (a.at <= at) q = a.text;
    return q;
  };
  const cleanup = await cleanupTranscript(
    romanized.map((text, i) => ({ text, question: questionFor(aligned[i].timestamp) })),
    {
      hindi: languages.hindi,
      candidateName: s.participantName,
      companyName: extra.organizationName,
      interviewTitle: s.interview.title,
      vocabulary,
    },
    async (system, user) =>
      (await callJson({ organizationId, task: "report", system, messages: [{ role: "user", content: user }], maxTokens: 8000, temperature: 0 })).raw,
    (raw) => extractJson<{ turns?: { id?: number; text?: string }[] }>(raw),
  );
  const finalTexts = cleanup.texts;
  const candidateWords = finalTexts.reduce((n, t) => n + t.split(/\s+/).length, 0);

  // Back up the rows we are about to replace (none for a session with zero answers).
  let backupPath: string | null = null;
  if (replaceable.length > 0) {
    backupPath = path.posix.join(recordingsDir, `transcript-backup-${sessionId.toLowerCase()}-${Date.now()}.json`);
    const { error } = await storage
      .from("recordings")
      .upload(
        backupPath,
        Buffer.from(
          JSON.stringify(
            {
              sessionId,
              savedAt: new Date().toISOString(),
              messages: replaceable,
              // Speech-to-text output before the clean-up pass, kept so a bad edit can be traced.
              ...(cleanup.changed > 0 ? { recordingTranscriptBeforeCleanup: romanized } : {}),
            },
            null,
            2,
          ),
        ),
        { contentType: "application/json" },
      );
    if (error) throw new RetranscribeError(`Could not back up the old transcript: ${error.message}`, 500);
  }

  // Insert the new candidate lines first, then remove the old ones by id, so a
  // failed insert never loses the old transcript and a re-run never stacks lines.
  const { error: insErr } = await supabaseAdmin.from("messages").insert(
    aligned.map((t, i) => ({
      sessionId,
      role: "USER" as const,
      content: finalTexts[i],
      contentType: "TEXT" as const,
      questionId: t.questionId,
      wordCount: finalTexts[i].split(/\s+/).length,
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

  void recordSessionError({
    sessionId,
    category: "tts_stt",
    severity: failures.length || cleanup.error ? "warning" : "info",
    source: opts.source,
    message: `Transcript rebuilt from recording (${model}): ${aligned.length} candidate lines (${candidateWords} words), replaced ${replaceable.length}. Clean-up: ${
      cleanup.ran ? `${cleanup.changed} lines fixed, ${cleanup.rejected} edits rejected${cleanup.wholeRejected ? " (all, word count drifted)" : ""}` : `skipped${cleanup.error ? ` (${cleanup.error})` : ""}`
    }.`,
    context: { stage: "retranscribe", model, source, backupPath, mime, notes: notes.slice(0, 5), engineFailures: failures.slice(0, 5) },
  });

  let summary: RetranscribeResult["summary"] = opts.auto ? "skipped" : "failed";
  if (!opts.auto) {
    try {
      summary = await generateSummaryForSession(sessionId);
    } catch (err) {
      log.error("Report regeneration after re-transcribe failed:", err);
    }
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
