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
  groupRecordingParts,
  isRunComplete,
  mimeForRecordingExt,
  type RecordingPartExt,
  type RecordingRun,
} from "@/lib/recording-parts";
import { recordSessionError } from "@/lib/session-error-log-server";
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
      `id, status, mediaStoragePrefix, audioRecordingUrl, mediaClearedAt,
       interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return null;
  const interview = session.interview as unknown as { projectId: string; project: { organizationId: string } };
  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("sessionId", sessionId)
    .maybeSingle();
  const subjectId = (candidate?.id as string | undefined) || `session-${sessionId}`;
  const orgId = interview.project.organizationId;
  return {
    sessionId,
    status: session.status as string,
    orgId,
    projectId: interview.projectId,
    prefix: candidateMediaPrefix({ orgId, projectId: interview.projectId, candidateId: subjectId }),
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
  return true;
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

async function downloadRun(run: RecordingRun): Promise<Buffer> {
  const bufs: Buffer[] = [];
  for (const p of run.parts) {
    const { data, error } = await supabaseAdmin.storage.from("recordings").download(p.key);
    if (error || !data) throw new Error(`Missing recording part ${p.seq}: ${error?.message ?? "no data"}`);
    bufs.push(Buffer.from(await data.arrayBuffer()));
  }
  return Buffer.concat(bufs);
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
export async function finalizeRecordingParts(
  sessionId: string,
  opts: { onlyIfMissing?: boolean; deleteParts?: boolean } = {},
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
    const finalKey = `${target.prefix}/recordings/recording-${sessionId}.${built.ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("recordings")
      .upload(finalKey, built.audio, { contentType: mimeForRecordingExt(built.ext), upsert: true });
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
