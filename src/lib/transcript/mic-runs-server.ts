/**
 * Server side of the candidate-only mic track: finds a session's mic parts,
 * joins each run and decodes it to 16 kHz mono WAV with ffmpeg.
 * Best-effort: anything missing or undecodable just means "no mic track".
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile as readLocalFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@/lib/logger";
import { contiguousMicParts, groupMicParts, mapWithConcurrency } from "@/lib/recording-parts";
import { listObjectKeys, readFile } from "@/lib/storage";
import { parseWav, type WavAudio } from "./mic-audio";

const log = createLogger("mic-runs");

const MAX_RUNS = 20;
const MAX_PARTS = 2000;

let ffmpegOk: boolean | null = null;
export function ffmpegAvailable(): boolean {
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

/** Any browser audio/video container → 16 kHz mono 16-bit WAV. */
export async function decodeToWav(data: Buffer, ext: string): Promise<WavAudio> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stt-decode-"));
  try {
    const input = path.join(dir, `in.${ext.replace(/[^a-z0-9]/gi, "") || "webm"}`);
    const output = path.join(dir, "out.wav");
    await writeFile(input, data);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", output],
        { timeout: 180_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return parseWav(await readLocalFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type MicRunAudio = {
  /** Browser epoch ms when this run's recorder started (audio time 0). */
  runId: number;
  audio: WavAudio;
  partsUsed: number;
  partsTotal: number;
};

export async function loadMicRuns(recordingsDir: string, sessionId: string): Promise<{ runs: MicRunAudio[]; notes: string[] }> {
  const notes: string[] = [];
  if (!ffmpegAvailable()) return { runs: [], notes: ["ffmpeg is not installed, so the mic-only track was not used"] };
  const keys = await listObjectKeys(`${recordingsDir.replace(/\/+$/, "")}/`);
  const runs = groupMicParts(keys, sessionId);
  if (!runs.length) return { runs: [], notes: [] };
  if (runs.length > MAX_RUNS || runs.reduce((n, r) => n + r.parts.length, 0) > MAX_PARTS) {
    return { runs: [], notes: ["too many mic parts; mic-only track skipped"] };
  }
  const out: MicRunAudio[] = [];
  for (const run of runs) {
    const parts = contiguousMicParts(run);
    if (!parts.length) {
      notes.push(`mic run ${run.runId}: first part missing`);
      continue;
    }
    try {
      const bufs = await mapWithConcurrency(parts, 6, async (p) => (await readFile("recordings", p.key)).data);
      const audio = await decodeToWav(Buffer.concat(bufs), run.ext);
      out.push({ runId: run.runId, audio, partsUsed: parts.length, partsTotal: run.parts.length });
      if (parts.length < run.parts.length) notes.push(`mic run ${run.runId}: used ${parts.length} of ${run.parts.length} parts (gap)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 120) : String(err);
      log.warn(`Mic run ${run.runId} for ${sessionId} not usable: ${msg}`);
      notes.push(`mic run ${run.runId}: ${msg}`);
    }
  }
  return { runs: out, notes };
}
