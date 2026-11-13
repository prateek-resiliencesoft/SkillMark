/**
 * Interview audio is uploaded in small parts while the interview runs, so a
 * slow network, a closed tab or a timed-out final upload can't lose the whole
 * recording. Part file name:
 *   part-{sessionId}-{runId}-{seq}-{elapsedSec}.{ext}
 * runId = recorder start time (ms) — a page reload starts a new run.
 * Parts of one run are byte-continuous MediaRecorder slices, so joining them
 * in seq order gives a playable file. Pure helpers (no I/O).
 */

export const RECORDING_PART_EXTS = ["webm", "m4a", "mp4", "ogg"] as const;
export type RecordingPartExt = (typeof RECORDING_PART_EXTS)[number];

export type RecordingPart = {
  key: string;
  sessionId: string;
  runId: number;
  seq: number;
  elapsedSec: number;
  ext: RecordingPartExt;
};

export type RecordingRun = {
  runId: number;
  ext: RecordingPartExt;
  parts: RecordingPart[];
  /** Seconds covered by this run (largest elapsedSec seen). */
  durationSec: number;
};

const PART_RE =
  /^part-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{10,16})-(\d{1,6})-(\d{1,6})\.(webm|m4a|mp4|ogg)$/i;

export function recordingPartFileName(opts: {
  sessionId: string;
  runId: number;
  seq: number;
  elapsedSec: number;
  ext: RecordingPartExt;
}): string {
  const seq = String(Math.max(0, Math.trunc(opts.seq))).padStart(5, "0");
  const t = String(Math.max(0, Math.round(opts.elapsedSec)));
  return `part-${opts.sessionId.toLowerCase()}-${Math.trunc(opts.runId)}-${seq}-${t}.${opts.ext}`;
}

export function parseRecordingPartKey(key: string): RecordingPart | null {
  const base = key.split("/").pop() ?? "";
  const m = PART_RE.exec(base);
  if (!m) return null;
  return {
    key,
    sessionId: m[1].toLowerCase(),
    runId: Number(m[2]),
    seq: Number(m[3]),
    elapsedSec: Number(m[4]),
    ext: m[5].toLowerCase() as RecordingPartExt,
  };
}

export function recordingExtForMime(mime: string | null | undefined): RecordingPartExt {
  const m = String(mime ?? "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  return "webm";
}

export function mimeForRecordingExt(ext: RecordingPartExt): string {
  if (ext === "webm") return "audio/webm";
  if (ext === "ogg") return "audio/ogg";
  return "audio/mp4";
}

/** Group a session's part keys into runs (oldest first), parts in seq order, duplicates removed. */
export function groupRecordingParts(keys: string[], sessionId: string): RecordingRun[] {
  const sid = sessionId.toLowerCase();
  const runs = new Map<number, Map<number, RecordingPart>>();
  for (const k of keys) {
    const p = parseRecordingPartKey(k);
    if (!p || p.sessionId !== sid) continue;
    const run = runs.get(p.runId) ?? new Map<number, RecordingPart>();
    run.set(p.seq, p);
    runs.set(p.runId, run);
  }
  return Array.from(runs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([runId, bySeq]) => {
      const parts = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
      return {
        runId,
        ext: parts[0].ext,
        parts,
        durationSec: parts.reduce((mx, p) => Math.max(mx, p.elapsedSec), 0),
      };
    });
}

/** Playable only when the first slice (container header) is there and none is missing. */
export function isRunComplete(run: RecordingRun): boolean {
  if (!run.parts.length || run.parts[0].seq !== 0) return false;
  return run.parts.every((p, i) => p.seq === i);
}
