/**
 * Server side of interview recordings: resolves the session's media folder,
 * links an uploaded recording to the session, and joins chunked parts into
 * the final recording when the browser couldn't finish the upload itself.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile as readLocalFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@/lib/logger";
import {
  FINALIZE_RETRY_DELAYS_MS,
  groupRecordingParts,
  isRunComplete,
  mapWithConcurrency,
  mimeForRecordingExt,
  type RecordingPartExt,
  type RecordingRun,
} from "@/lib/recording-parts";
import { recordSessionError } from "@/lib/session-error-log-server";
import { onRecordingLinked } from "@/lib/session-report-server";
import { listObjectKeys } from "@/lib/storage";
import { candidateMediaPrefix } from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";

const log = createLogger("recording-parts");

export type SessionMediaTarget = {
  sessionId: string;
  status: string;
  orgId: string;
  projectId: string;
  prefix: string;
  audioRecordingUrl: string | null;
  mediaClearedAt: string | null;
  mediaStoragePrefix: string | null;
};

/** Same folder rule as /api/session/upload: candidate id, else session-{id}. */
export async function resolveSessionMediaTarget(sessionId: string): Promise<SessionMediaTarget | null> {
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select(
      `id, status, mediaStoragePrefix, audioRecordingUrl, mediaClearedAt, participantName, participantEmail,
       interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;
  const interview = session.interview as unknown as { projectId: string; project: { organizationId: string } };
  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id, name, email")
    .eq("sessionId", sessionId)
    .maybeSingle();
  const candidateName =
    (candidate?.name as string | undefined) ||
    (session.participantName as string | undefined);
  const subjectId = (candidate?.id as string | undefined) || `session-${sessionId}`;
  const orgId = interview.project.organizationId;
  const prefix =
    (session.mediaStoragePrefix as string | null) ||
    candidateMediaPrefix({
      orgId,
      projectId: interview.projectId,
      candidateId: subjectId,
      candidateName,
      candidateEmail:
        (candidate?.email as string | null | undefined) ||
        ((session as unknown as { participantEmail?: string | null }).participantEmail ?? null),
    });
  return {
    sessionId,
    status: session.status as string,
    orgId,
    projectId: interview.projectId,
    prefix,
    audioRecordingUrl: (session.audioRecordingUrl as string | null) ?? null,
    mediaClearedAt: (session.mediaClearedAt as string | null) ?? null,
    mediaStoragePrefix: (session.mediaStoragePrefix as string | null) ?? null,
  };
}

/**
 * Save the recording's storage key on the session (idempotent). Stored as the
 * raw object key (orgs/.../recordings/<file>), same as session.saveRecording.
 */
export async function linkRecordingToSession(
  sessionId: string,
  objectKey: string,
  audioDuration?: number | null,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const update: Record<string, unknown> = { audioRecordingUrl: objectKey, ...extra };
  if (typeof audioDuration === "number" && Number.isFinite(audioDuration) && audioDuration > 0) {
    update.audioDuration = Math.round(audioDuration);
  }
  const { error } = await supabaseAdmin.from("sessions").update(update).eq("id", sessionId).is("mediaClearedAt", null);
  if (error) {
    log.error(`Could not link recording to session ${sessionId}: ${error.message}`);
    void recordSessionError({
      sessionId,
      category: "client",
      severity: "error",
      source: "recording/link",
      message: `Recording uploaded but could not be linked to the session: ${error.message}`,
      context: { stage: "recording_link", objectKey },
    });
    return false;
  }
  void onRecordingLinked(sessionId).catch((err) => log.error(`Recording-linked report for ${sessionId} failed:`, err));
  return true;
}

/** Periodic proctoring captures are named `<iso>-camera.jpg` / `<iso>-screen.jpg`. */
export function periodicScreenshotType(fileName: string): "camera" | "screen" | null {
  const m = /-(camera|screen)\.jpg$/.exec(fileName);
  return m ? (m[1] as "camera" | "screen") : null;
}

const screenshotLinkQueue = new Map<string, Promise<unknown>>();

/**
 * Append a periodic screenshot to sessions.screenshots at upload time. The
 * browser used to be the only one saving this list (once, at the end), so a
 * slow or failed final save lost every capture even though the files were stored.
 * Serialized per session so camera + screen uploads don't overwrite each other.
 */
export function linkScreenshotToSession(
  sessionId: string,
  entry: { url: string; path: string; timestamp: string; type: "camera" | "screen" },
): Promise<boolean> {
  const prev = screenshotLinkQueue.get(sessionId) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const { data, error } = await supabaseAdmin
        .from("sessions")
        .select("screenshots")
        .eq("id", sessionId)
        .is("mediaClearedAt", null)
        .maybeSingle();
      if (error || !data) {
        if (error) log.error(`Could not read screenshots for ${sessionId}: ${error.message}`);
        return false;
      }
      const existing = Array.isArray(data.screenshots) ? (data.screenshots as { path?: string }[]) : [];
      if (existing.some((s) => s.path === entry.path)) return true;
      const { error: upErr } = await supabaseAdmin
        .from("sessions")
        .update({ screenshots: [...existing, entry] })
        .eq("id", sessionId)
        .is("mediaClearedAt", null);
      if (upErr) {
        log.error(`Could not link screenshot to session ${sessionId}: ${upErr.message}`);
        return false;
      }
      return true;
    });
  screenshotLinkQueue.set(sessionId, run);
  void run.finally(() => {
    if (screenshotLinkQueue.get(sessionId) === run) screenshotLinkQueue.delete(sessionId);
  });
  return run;
}

let ffmpegOk: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegOk == null) {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
      ffmpegOk = true;
    } catch {
      ffmpegOk = false;
    }
  }
  return ffmpegOk;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: 180_000 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

async function downloadPart(key: string, seq: number): Promise<Buffer> {
  let lastMsg = "no data";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabaseAdmin.storage.from("recordings").download(key);
    if (data && !error) return Buffer.from(await data.arrayBuffer());
    lastMsg = error?.message ?? "no data";
    // A file that simply isn't there won't appear on retry.
    if (/ENOENT|no such file|not found/i.test(lastMsg)) break;
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw new Error(`Missing recording part ${seq}: ${lastMsg}`);
}

/**
 * Parts are fetched 6 at a time (a 15-min interview is ~90 parts; one by one
 * from a remote bucket took longer than the browser waited), then joined in order.
 */
async function downloadRun(run: RecordingRun): Promise<Buffer> {
  const bufs = await mapWithConcurrency(run.parts, 6, (p) => downloadPart(p.key, p.seq));
  return Buffer.concat(bufs);
}

/** Seconds of audio ffprobe can read, or null when ffprobe isn't installed / can't tell. */
function probeDurationSec(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const n = Number(String(stdout).trim());
        resolve(Number.isFinite(n) ? n : null);
      },
    );
  });
}

/**
 * The joined file must be decodable before the parts it came from are
 * deleted. Returns a reason when it isn't; null when fine or unknown (no ffprobe).
 */
async function verifyRecording(audio: Buffer, ext: RecordingPartExt): Promise<string | null> {
  if (!audio.length) return "joined recording is empty";
  if (!hasFfmpeg()) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "rec-verify-"));
  try {
    const f = path.join(dir, `check.${ext}`);
    await writeFile(f, audio);
    const dur = await probeDurationSec(f);
    if (dur === null) return null;
    return dur > 0.5 ? null : `joined recording has no playable audio (${dur.toFixed(1)}s)`;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * One run: join bytes (remux with ffmpeg when present so players see the
 * duration). Several runs (page reload): ffmpeg joins them; without ffmpeg
 * keep the longest run.
 */
async function buildRecording(
  runs: RecordingRun[],
): Promise<{ audio: Buffer; ext: RecordingPartExt; durationSec: number; note?: string }> {
  const usable = runs.filter(isRunComplete);
  const pool = usable.length ? usable : runs;
  const notes: string[] = [];
  if (usable.length < runs.length) notes.push(`${runs.length - usable.length} incomplete part set(s) skipped`);

  if (pool.length === 1 || !hasFfmpeg()) {
    const run = pool.reduce((a, b) => (b.durationSec > a.durationSec ? b : a));
    if (pool.length > 1) notes.push(`kept the longest of ${pool.length} recordings (ffmpeg not installed)`);
    let audio = await downloadRun(run);
    if (hasFfmpeg()) {
      const dir = await mkdtemp(path.join(os.tmpdir(), "rec-"));
      try {
        const input = path.join(dir, `in.${run.ext}`);
        const output = path.join(dir, `out.${run.ext}`);
        await writeFile(input, audio);
        await runFfmpeg(["-i", input, "-vn", "-c", "copy", ...(run.ext === "webm" ? [] : ["-movflags", "+faststart"]), output]);
        const out = await readLocalFile(output);
        if (out.length > 0) audio = out;
      } catch (err) {
        log.warn(`Remux skipped: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return { audio, ext: run.ext, durationSec: run.durationSec, note: notes.join("; ") || undefined };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "rec-"));
  try {
    const inputs: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const f = path.join(dir, `run${i}.${pool[i].ext}`);
      await writeFile(f, await downloadRun(pool[i]));
      inputs.push("-i", f);
    }
    const output = path.join(dir, "out.m4a");
    const filter = `${pool.map((_, i) => `[${i}:a]`).join("")}concat=n=${pool.length}:v=0:a=1[a]`;
    await runFfmpeg([...inputs, "-filter_complex", filter, "-map", "[a]", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", output]);
    const audio = await readLocalFile(output);
    notes.push(`joined ${pool.length} recordings (page was reloaded)`);
    return { audio, ext: "m4a", durationSec: pool.reduce((s, r) => s + r.durationSec, 0), note: notes.join("; ") };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type FinalizeResult = {
  audioUrl?: string;
  audioDuration?: number;
  parts: number;
  status: "finalized" | "existing" | "no_parts" | "not_found" | "media_cleared" | "failed";
};

/**
 * Join uploaded parts into recordings/recording-{sessionId}.{ext} and link it.
 *  onlyIfMissing – skip when the session already has a recording (server fallback).
 *  deleteParts   – remove the parts afterwards.
 */
/** One finalize per session at a time: the browser, the voice-save fallback and retries must not race. */
const finalizeInFlight = new Map<string, Promise<FinalizeResult>>();

export function finalizeRecordingParts(
  sessionId: string,
  opts: { onlyIfMissing?: boolean; deleteParts?: boolean } = {},
): Promise<FinalizeResult> {
  const prev = finalizeInFlight.get(sessionId) ?? Promise.resolve(null);
  const run = prev
    .catch(() => null)
    .then(() => finalizeRecordingPartsNow(sessionId, opts));
  finalizeInFlight.set(sessionId, run);
  void run.finally(() => {
    if (finalizeInFlight.get(sessionId) === run) finalizeInFlight.delete(sessionId);
  });
  return run;
}

const scheduledFinalize = new Set<string>();

/**
 * Finalize in the background with retries (the browser no longer waits for the
 * join). Attempts run after 0s, 15s, 60s and 3 min; a later attempt still
 * runs when an earlier one failed for a transient reason (storage, ffmpeg).
 * Returns false when one is already scheduled for this session.
 */
export function scheduleRecordingFinalize(
  sessionId: string,
  opts: { onlyIfMissing?: boolean; deleteParts?: boolean; reason?: string } = {},
): boolean {
  if (scheduledFinalize.has(sessionId)) return false;
  scheduledFinalize.add(sessionId);
  const attempt = async (i: number): Promise<void> => {
    let res: FinalizeResult | null = null;
    try {
      res = await finalizeRecordingParts(sessionId, opts);
    } catch (err) {
      log.error(`Background finalize for ${sessionId} threw:`, err);
    }
    const retry = !res || res.status === "failed";
    if (retry && i + 1 < FINALIZE_RETRY_DELAYS_MS.length) {
      log.warn(`Recording finalize for ${sessionId} will retry (attempt ${i + 2}/${FINALIZE_RETRY_DELAYS_MS.length})`);
      setTimeout(() => void attempt(i + 1), FINALIZE_RETRY_DELAYS_MS[i + 1]);
      return;
    }
    scheduledFinalize.delete(sessionId);
    if (retry) log.error(`Recording finalize for ${sessionId} gave up after ${FINALIZE_RETRY_DELAYS_MS.length} attempts`);
    else log.info(`Recording finalize for ${sessionId} (${opts.reason ?? "background"}): ${res?.status}`);
  };
  setTimeout(() => void attempt(0), FINALIZE_RETRY_DELAYS_MS[0]);
  return true;
}

async function finalizeRecordingPartsNow(
  sessionId: string,
  opts: { onlyIfMissing?: boolean; deleteParts?: boolean },
): Promise<FinalizeResult> {
  const target = await resolveSessionMediaTarget(sessionId);
  if (!target) return { parts: 0, status: "not_found" };
  if (target.mediaClearedAt) return { parts: 0, status: "media_cleared" };
  if (opts.onlyIfMissing && target.audioRecordingUrl) {
    return { audioUrl: target.audioRecordingUrl, parts: 0, status: "existing" };
  }

  const keys = await listObjectKeys(`${target.prefix}/recordings/`);
  const runs = groupRecordingParts(keys, sessionId);
  const partCount = runs.reduce((n, r) => n + r.parts.length, 0);
  if (!partCount) {
    return target.audioRecordingUrl
      ? { audioUrl: target.audioRecordingUrl, parts: 0, status: "existing" }
      : { parts: 0, status: "no_parts" };
  }

  try {
    const built = await buildRecording(runs);
    const broken = await verifyRecording(built.audio, built.ext);
    if (broken) throw new Error(broken);
    const finalKey = `${target.prefix}/recordings/recording-${sessionId}.${built.ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("recordings")
      // Joins parts already stored for this interview, so it is never refused by the cap.
      .upload(finalKey, built.audio, { contentType: mimeForRecordingExt(built.ext), upsert: true, liveSession: true });
    if (upErr) throw new Error(`Storage error: ${upErr.message}`);

    const linked = await linkRecordingToSession(
      sessionId,
      finalKey,
      built.durationSec,
      target.mediaStoragePrefix ? {} : { mediaStoragePrefix: target.prefix },
    );
    if (!linked) throw new Error("could not save the recording on the session");

    if (opts.deleteParts) {
      await supabaseAdmin.storage.from("recordings").remove(runs.flatMap((r) => r.parts.map((p) => p.key)));
    }
    log.info(`Recording finalized for ${sessionId}: ${partCount} parts, ${Math.round(built.durationSec)}s${built.note ? ` (${built.note})` : ""}`);
    if (built.note) {
      void recordSessionError({
        sessionId,
        category: "client",
        severity: "info",
        source: "recording/finalize",
        message: `Recording saved from uploaded parts: ${built.note}`,
        context: { stage: "recording_finalize", parts: partCount, runs: runs.length },
      });
    }
    return { audioUrl: finalKey, audioDuration: Math.round(built.durationSec), parts: partCount, status: "finalized" };
  } catch (err) {
    log.error(`Recording finalize failed for ${sessionId}:`, err);
    void recordSessionError({
      sessionId,
      category: "client",
      severity: "error",
      source: "recording/finalize",
      message: `Recording could not be assembled: ${err instanceof Error ? err.message : String(err)}`,
      context: { stage: "recording_finalize", parts: partCount, runs: runs.length },
    });
    return { parts: partCount, status: "failed" };
  }
}
