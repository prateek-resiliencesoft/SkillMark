/**
 * Round 2 recording + snapshots (pure helpers, no I/O).
 *
 * The candidate's browser records three audio tracks while the round runs and
 * uploads them in ~10 s parts, like round 1 (see src/lib/mic-track-recorder.ts):
 *   mix   – candidate mic + everyone they hear (playback in the report)
 *   cand  – the candidate's mic only           (transcript, "Candidate" lines)
 *   panel – everything the candidate hears     (transcript, "Interviewer" lines)
 * Part file name: r2{track}-{roundTwoId}-{runId}-{seq}-{elapsedSec}.{ext}
 * runId = that recorder's start time (epoch ms); a rejoin starts a new run.
 *
 * Camera snapshots (one at start, then every minute, like round 1's periodic captures):
 *   r2snap-{roundTwoId}-{epochMs}.jpg
 */
import type { RecordingPart, RecordingPartExt, RecordingRun } from "@/lib/recording-parts";

export const R2_AUDIO_TRACKS = ["mix", "cand", "panel"] as const;
export type R2AudioTrack = (typeof R2_AUDIO_TRACKS)[number];

/** Same cadence as round 1's periodic camera captures. */
export const R2_SNAPSHOT_INTERVAL_MS = 60_000;
/** First snapshot shortly after the candidate is admitted (camera has started). */
export const R2_FIRST_SNAPSHOT_MS = 5_000;
/** Uploads are still accepted this long after the round ends (last parts in flight). */
export const R2_UPLOAD_GRACE_MS = 10 * 60_000;
/** ~4 h of parts at one per 10 s, per track. */
export const R2_MAX_PARTS_PER_TRACK = 1_500;
export const R2_MAX_SNAPSHOTS = 300;

/** Transcript rows rebuilt from the recording carry these participant ids (live rows use LiveKit identities). */
export const R2_RECORDING_PARTICIPANT = { candidate: "recording:candidate", interviewer: "recording:panel" } as const;
export const isRecordingRow = (participantId: string | null | undefined) => String(participantId ?? "").startsWith("recording:");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PART_RE = new RegExp(`^r2(mix|cand|panel)-(${UUID})-(\\d{10,16})-(\\d{1,6})-(\\d{1,6})\\.(webm|m4a|mp4|ogg)$`, "i");
const SNAP_RE = new RegExp(`^r2snap-(${UUID})-(\\d{10,16})\\.jpg$`, "i");

/** Uploads are open while the candidate is in the call, and briefly after it ends (last parts in flight). */
export function roundAcceptsMedia(
  round: { status: string; candidateAdmittedAt?: string | null; endedAt?: string | null },
  now = Date.now(),
): boolean {
  if (!round.candidateAdmittedAt) return false;
  if (round.status === "live") return true;
  if (round.status === "ended" && round.endedAt) return now - Date.parse(round.endedAt) <= R2_UPLOAD_GRACE_MS;
  return false;
}

export function isR2AudioTrack(v: unknown): v is R2AudioTrack {
  return typeof v === "string" && (R2_AUDIO_TRACKS as readonly string[]).includes(v);
}

export function r2PartFileName(opts: {
  track: R2AudioTrack;
  roundTwoId: string;
  runId: number;
  seq: number;
  elapsedSec: number;
  ext: RecordingPartExt;
}): string {
  const seq = String(Math.max(0, Math.trunc(opts.seq))).padStart(5, "0");
  const t = String(Math.max(0, Math.round(opts.elapsedSec)));
  return `r2${opts.track}-${opts.roundTwoId.toLowerCase()}-${Math.trunc(opts.runId)}-${seq}-${t}.${opts.ext}`;
}

export type R2Part = RecordingPart & { track: R2AudioTrack };

export function parseR2PartKey(key: string): R2Part | null {
  const base = key.split("/").pop() ?? "";
  const m = PART_RE.exec(base);
  if (!m) return null;
  return {
    key,
    track: m[1].toLowerCase() as R2AudioTrack,
    sessionId: m[2].toLowerCase(),
    runId: Number(m[3]),
    seq: Number(m[4]),
    elapsedSec: Number(m[5]),
    ext: m[6].toLowerCase() as RecordingPartExt,
  };
}

/** One track's parts grouped into runs (oldest first), parts in seq order, duplicates removed. */
export function groupR2Parts(keys: string[], roundTwoId: string, track: R2AudioTrack): RecordingRun[] {
  const id = roundTwoId.toLowerCase();
  const runs = new Map<number, Map<number, RecordingPart>>();
  for (const k of keys) {
    const p = parseR2PartKey(k);
    if (!p || p.sessionId !== id || p.track !== track) continue;
    const run = runs.get(p.runId) ?? new Map<number, RecordingPart>();
    run.set(p.seq, p);
    runs.set(p.runId, run);
  }
  return Array.from(runs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([runId, bySeq]) => {
      const parts = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
      return { runId, ext: parts[0].ext, parts, durationSec: parts.reduce((mx, p) => Math.max(mx, p.elapsedSec), 0) };
    });
}

export function r2SnapshotFileName(roundTwoId: string, at: number): string {
  return `r2snap-${roundTwoId.toLowerCase()}-${Math.trunc(at)}.jpg`;
}

export function parseR2SnapshotKey(key: string, roundTwoId: string): { key: string; at: number } | null {
  const m = SNAP_RE.exec(key.split("/").pop() ?? "");
  if (!m || m[1].toLowerCase() !== roundTwoId.toLowerCase()) return null;
  return { key, at: Number(m[2]) };
}

/** The final joined recording for playback. */
export function r2RecordingFileName(roundTwoId: string, ext: string): string {
  return `round2-recording-${roundTwoId.toLowerCase()}.${ext}`;
}

/** Folder (inside the candidate's media folder) that holds one round 2's media. */
export function r2MediaFolder(candidatePrefix: string, roundTwoId: string, kind: "recordings" | "images"): string {
  return `${candidatePrefix.replace(/\/+$/, "")}/${kind}/round2-${roundTwoId.toLowerCase()}`;
}

// ── Transcript from the two tracks ───────────────────────────────────────────

export type R2Clip = { startMs: number; endMs: number; text: string };
export type R2TranscriptRow = {
  speakerRole: "candidate" | "interviewer";
  participantId: string;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
};

/**
 * Candidate clips (mic track) and panel clips (what the candidate heard), both in
 * epoch ms, → transcript rows relative to the round start, in time order.
 * Panel speech the candidate's mic also picked up (speakers, no headphones) shows
 * on the candidate track too; a candidate clip that just repeats an overlapping
 * panel clip is dropped.
 */
export function buildR2TranscriptRows(
  candidate: R2Clip[],
  panel: R2Clip[],
  originMs: number,
  panelName = "Interviewer",
): R2TranscriptRow[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const echoes = (c: R2Clip) =>
    panel.some((p) => {
      if (p.endMs < c.startMs - 1500 || p.startMs > c.endMs + 1500) return false;
      const a = norm(c.text);
      const b = norm(p.text);
      if (!a || !b) return false;
      if (b.includes(a)) return true;
      const words = a.split(" ");
      const pw = new Set(b.split(" "));
      return words.length >= 3 && words.filter((w) => pw.has(w)).length / words.length >= 0.8;
    });
  const rel = (ms: number) => Math.max(0, Math.round(ms - originMs));
  const rows: R2TranscriptRow[] = [
    ...candidate
      .filter((c) => c.text.trim() && !echoes(c))
      .map((c) => ({
        speakerRole: "candidate" as const,
        participantId: R2_RECORDING_PARTICIPANT.candidate,
        speakerName: "Candidate",
        text: c.text.trim(),
        startMs: rel(c.startMs),
        endMs: Math.max(rel(c.startMs), rel(c.endMs)),
      })),
    ...panel
      .filter((p) => p.text.trim())
      .map((p) => ({
        speakerRole: "interviewer" as const,
        participantId: R2_RECORDING_PARTICIPANT.interviewer,
        speakerName: panelName,
        text: p.text.trim(),
        startMs: rel(p.startMs),
        endMs: Math.max(rel(p.startMs), rel(p.endMs)),
      })),
  ];
  return rows.sort((a, b) => a.startMs - b.startMs || (a.speakerRole === "interviewer" ? -1 : 1));
}

const words = (texts: string[]) => texts.reduce((n, t) => n + (t.trim() ? t.trim().split(/\s+/).length : 0), 0);

/**
 * Use the recording transcript instead of the live one?
 *  - no live transcript at all → yes, whenever the recording has candidate speech;
 *  - otherwise only when most clips were transcribed and it keeps ≥ 60% of the
 *    live candidate words (same rule as round 1's automatic pass).
 */
export function shouldUseRecordingTranscript(input: {
  liveCandidateTexts: string[];
  recordingCandidateTexts: string[];
  clipsTotal: number;
  clipsMissed: number;
}): { use: boolean; reason: string } {
  const rec = words(input.recordingCandidateTexts);
  const live = words(input.liveCandidateTexts);
  if (rec === 0) return { use: false, reason: "no candidate speech in the recording" };
  if (live === 0) return { use: true, reason: "no live transcript" };
  if (input.clipsTotal > 0 && input.clipsMissed / input.clipsTotal > 0.3) {
    return { use: false, reason: `${input.clipsMissed} of ${input.clipsTotal} clips could not be transcribed` };
  }
  if (rec < live * 0.6) return { use: false, reason: `recording kept ${rec} of ${live} live words` };
  return { use: true, reason: `recording ${rec} words vs live ${live}` };
}
