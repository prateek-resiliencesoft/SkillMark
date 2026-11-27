import "server-only";
import path from "node:path";
import { loadCredsPair } from "@/lib/ai/registry";
import { callJson } from "@/lib/ai/json-call";
import { createLogger } from "@/lib/logger";
import { contiguousMicParts, type RecordingRun } from "@/lib/recording-parts";
import { buildRecording } from "@/lib/recording-parts-server";
import {
  R2_MAX_SNAPSHOTS,
  buildR2TranscriptRows,
  groupR2Parts,
  isRecordingRow,
  parseR2SnapshotKey,
  r2MediaFolder,
  r2RecordingFileName,
  shouldUseRecordingTranscript,
  type R2AudioTrack,
  type R2Clip,
} from "@/lib/round-two/recording";
import { normalizePlan } from "@/lib/round-two/types";
import { candidateMediaPrefix } from "@/lib/storage-paths";
import { listObjectKeys, readFile } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cleanupTranscript } from "@/lib/transcript/cleanup";
import { extractJson } from "@/lib/ai/extract-json";
import { decodeToWav, ffmpegAvailable } from "@/lib/transcript/mic-runs-server";
import { describeNoSttReason, selectSttCandidates, sttLanguagesFor, type SttLanguages } from "@/lib/transcript/stt-engines";
import { transcribeAudioClips, type PipelineContext } from "@/lib/transcript/stt-pipeline";
import { buildPromptHint, buildVocabulary } from "@/lib/transcript/stt-vocab";
import { repairRomanHinglish } from "@/lib/transcript/transliterate";

const log = createLogger("round-two/media");

/** Speech-to-text share of the report run (the report lock goes stale after 15 min). */
const TRANSCRIBE_BUDGET_MS = 7 * 60_000;
/** After "End": wait until the candidate's last parts stop arriving, at most this long after endedAt. */
const FINAL_PARTS_WINDOW_MS = 45_000;
const FINAL_PARTS_POLL_MS = 3_000;
const SIGNED_URL_TTL_SEC = 60 * 60 * 6;

export type RoundMediaRow = {
  id: string;
  organizationId: string;
  projectId: string;
  candidateId: string;
  sourceSessionId: string | null;
  title: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  recordingUrl: string | null;
  candidateAdmittedAt?: string | null;
  questionPlan?: unknown;
};

const ROW_COLUMNS =
  'id, "organizationId", "projectId", "candidateId", "sourceSessionId", title, status, "startedAt", "endedAt", "recordingUrl", "candidateAdmittedAt", "questionPlan"';

export async function loadRoundMediaRow(roundTwoId: string): Promise<RoundMediaRow | null> {
  const { data } = await supabaseAdmin.from("round_two_interviews").select(ROW_COLUMNS).eq("id", roundTwoId).maybeSingle();
  return (data as RoundMediaRow | null) ?? null;
}

/**
 * The candidate's media folder: the round 1 session's folder when there is one
 * (one person = one folder), else a folder keyed by the candidate id (stable even
 * if the name is edited later).
 */
export async function roundTwoCandidatePrefix(r: Pick<RoundMediaRow, "organizationId" | "projectId" | "candidateId" | "sourceSessionId">): Promise<string> {
  if (r.sourceSessionId) {
    const { data } = await supabaseAdmin.from("sessions").select("mediaStoragePrefix").eq("id", r.sourceSessionId).maybeSingle();
    const prefix = (data as { mediaStoragePrefix?: string | null } | null)?.mediaStoragePrefix;
    if (prefix && prefix.startsWith(`orgs/${r.organizationId}/`)) return prefix.replace(/\/+$/, "");
  }
  return candidateMediaPrefix({ orgId: r.organizationId, projectId: r.projectId, candidateId: r.candidateId });
}

export async function roundTwoMediaDirs(r: RoundMediaRow): Promise<{ recordings: string; images: string }> {
  const prefix = await roundTwoCandidatePrefix(r);
  return { recordings: r2MediaFolder(prefix, r.id, "recordings"), images: r2MediaFolder(prefix, r.id, "images") };
}

/** Interview language of the round 1 this round follows (drives the speech-to-text language hints). */
export async function roundTwoSttLanguages(r: Pick<RoundMediaRow, "sourceSessionId">): Promise<SttLanguages> {
  if (!r.sourceSessionId) return sttLanguagesFor(null);
  try {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select("language, interview:interviews!inner(language)")
      .eq("id", r.sourceSessionId)
      .maybeSingle();
    const row = data as { language?: string | null; interview?: { language?: string | null } | null } | null;
    return sttLanguagesFor(row?.interview?.language ?? null, row?.language ?? null);
  } catch {
    return sttLanguagesFor(null);
  }
}

/**
 * After the host ends the round the candidate's tab still sends its last parts.
 * Readiness check: wait until the part count stops changing (or the window closes).
 */
async function waitForFinalParts(r: RoundMediaRow, dir: string): Promise<void> {
  const endedAt = r.endedAt ? Date.parse(r.endedAt) : 0;
  if (!endedAt || Date.now() > endedAt + FINAL_PARTS_WINDOW_MS) return;
  let last = -1;
  let stable = 0;
  while (Date.now() < endedAt + FINAL_PARTS_WINDOW_MS) {
    const n = (await listObjectKeys(`${dir}/`).catch(() => [] as string[])).length;
    stable = n === last ? stable + 1 : 0;
    if (stable >= 2) return;
    last = n;
    await new Promise((res) => setTimeout(res, FINAL_PARTS_POLL_MS));
  }
}

/** Join the "mix" parts into one playable file and store its key in recordingUrl. */
export async function finalizeRoundTwoRecording(r: RoundMediaRow, keys: string[], dir: string): Promise<string> {
  if (r.recordingUrl) return "recording already saved";
  const runs = groupR2Parts(keys, r.id, "mix");
  if (!runs.length) return "no audio was recorded in the candidate's browser";
  const built = await buildRecording(runs);
  const key = `${dir}/${r2RecordingFileName(r.id, built.ext)}`;
  const { error } = await supabaseAdmin.storage
    .from("recordings")
    .upload(key, built.audio, { contentType: built.ext === "webm" ? "audio/webm" : built.ext === "ogg" ? "audio/ogg" : "audio/mp4", upsert: true });
  if (error) throw new Error(`Recording could not be saved: ${error.message}`);
  await supabaseAdmin.from("round_two_interviews").update({ recordingUrl: key }).eq("id", r.id);
  return `recording saved (${Math.round(built.durationSec / 60)} min${built.note ? `; ${built.note}` : ""})`;
}

type TrackResult = { clips: R2Clip[]; segments: number; missed: number; usage: Record<string, number>; failures: string[] };

async function transcribeTrack(
  r: RoundMediaRow,
  keys: string[],
  track: R2AudioTrack,
  ctx: PipelineContext,
  deadlineAt: number,
  notes: string[],
): Promise<TrackResult> {
  const out: TrackResult = { clips: [], segments: 0, missed: 0, usage: {}, failures: [] };
  for (const run of groupR2Parts(keys, r.id, track) as RecordingRun[]) {
    const parts = contiguousMicParts(run);
    if (!parts.length) {
      notes.push(`${track} run ${run.runId}: first part missing`);
      continue;
    }
    try {
      const bufs: Buffer[] = [];
      for (const p of parts) bufs.push((await readFile("recordings", p.key)).data);
      const audio = await decodeToWav(Buffer.concat(bufs), run.ext);
      const res = await transcribeAudioClips(audio, ctx, { deadlineAt });
      out.segments += res.segments;
      out.missed += res.unTranscribed;
      out.failures.push(...res.failures);
      for (const [k, n] of Object.entries(res.usage)) out.usage[k] = (out.usage[k] ?? 0) + n;
      for (const c of res.clips) out.clips.push({ text: c.text, startMs: run.runId + c.startSec * 1000, endMs: run.runId + c.endSec * 1000 });
    } catch (err) {
      notes.push(`${track} run ${run.runId}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  }
  return out;
}

/**
 * Rebuild the round 2 transcript from the candidate-side tracks (candidate mic →
 * "Candidate", what they heard → "Interviewer"), with the engine the org's own
 * keys allow (Gemini 3.5 Transcribe / OpenAI / Groq; see stt-engines.ts).
 * Replaces the live transcript only when that one is empty or clearly worse.
 */
export async function refineRoundTwoTranscript(r: RoundMediaRow, keys: string[], recordingsDir: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("round_two_transcript")
    .select('id, "speakerRole", "participantId", text, "startMs"')
    .eq("roundTwoId", r.id)
    .limit(5000);
  const rows = (existing ?? []) as { id: string; speakerRole: string; participantId: string; text: string; startMs: number }[];
  if (rows.some((x) => isRecordingRow(x.participantId))) return "transcript already rebuilt from the recording";
  if (!groupR2Parts(keys, r.id, "cand").length && !groupR2Parts(keys, r.id, "panel").length) return "no recorded audio to transcribe";
  if (!ffmpegAvailable()) return "ffmpeg is not installed, so the recording was not transcribed";

  const { merged, routing } = await loadCredsPair(r.organizationId);
  const candidates = selectSttCandidates({ merged, routing });
  if (!candidates.length) return describeNoSttReason(merged);

  const [languages, { data: cand }, { data: org }] = await Promise.all([
    roundTwoSttLanguages(r),
    supabaseAdmin.from("candidates").select("name, skills").eq("id", r.candidateId).maybeSingle(),
    supabaseAdmin.from("organizations").select("name").eq("id", r.organizationId).maybeSingle(),
  ]);
  const candidateName = ((cand as { name?: string | null } | null)?.name ?? "").trim() || null;
  const skillsRaw = (cand as { skills?: unknown } | null)?.skills;
  const skills = Array.isArray(skillsRaw) ? skillsRaw.filter((x): x is string => typeof x === "string").slice(0, 40) : [];
  const companyName = (org as { name?: string | null } | null)?.name ?? null;
  const questions = normalizePlan(r.questionPlan).map((q) => q.text);
  const vocabulary = buildVocabulary({ candidateName, companyName, interviewTitle: r.title, terms: skills.slice(0, 15), texts: [...questions, skills.join(". ")] });
  const ctx: PipelineContext = { candidates, languages, vocabulary, promptHint: buildPromptHint(vocabulary, { hindi: languages.hindi }) };
  const deadlineAt = Date.now() + TRANSCRIBE_BUDGET_MS;
  const notes: string[] = [];

  // Candidate first: it matters most if the time budget runs out.
  const candTrack = await transcribeTrack(r, keys, "cand", ctx, deadlineAt, notes);
  const panelTrack = await transcribeTrack(r, keys, "panel", ctx, deadlineAt, notes);
  const fix = (c: R2Clip) => ({ ...c, text: repairRomanHinglish(c.text, { vocabulary }) });
  const candClips = candTrack.clips.map(fix);
  const panelClips = panelTrack.clips.map(fix);

  const liveCandidate = rows.filter((x) => x.speakerRole === "candidate").map((x) => x.text);
  const decision = shouldUseRecordingTranscript({
    liveCandidateTexts: liveCandidate,
    recordingCandidateTexts: candClips.map((c) => c.text),
    clipsTotal: candTrack.segments,
    clipsMissed: candTrack.missed,
  });
  const usage = { ...candTrack.usage };
  for (const [k, n] of Object.entries(panelTrack.usage)) usage[k] = (usage[k] ?? 0) + n;
  const usageLabel = Object.entries(usage).map(([k, n]) => `${k}×${n}`).join(", ") || "none";
  const failures = [...candTrack.failures, ...panelTrack.failures].slice(0, 3);
  if (!decision.use) {
    return `live transcript kept: ${decision.reason} (engines: ${usageLabel}${failures.length ? `; ${failures.join("; ")}` : ""}${notes.length ? `; ${notes.slice(0, 3).join("; ")}` : ""})`;
  }

  // Short text-model pass that fixes only clear mishearings of names and skills (same as round 1).
  let candTexts = candClips.map((c) => c.text);
  try {
    const cleanup = await cleanupTranscript(
      candTexts.map((text) => ({ text })),
      { hindi: languages.hindi, candidateName, companyName, interviewTitle: r.title, vocabulary },
      async (system, user) =>
        (await callJson({ organizationId: r.organizationId, task: "report", system, messages: [{ role: "user", content: user }], maxTokens: 8000, temperature: 0 })).raw,
      (raw) => extractJson<{ turns?: { id?: number; text?: string }[] }>(raw),
    );
    if (cleanup.texts.length === candTexts.length) candTexts = cleanup.texts;
  } catch {
    /* clean-up is optional */
  }
  const origin = r.startedAt ? Date.parse(r.startedAt) : Math.min(...[...candClips, ...panelClips].map((c) => c.startMs));
  const newRows = buildR2TranscriptRows(candClips.map((c, i) => ({ ...c, text: candTexts[i] ?? c.text })), panelClips, origin);
  if (!newRows.length) return "live transcript kept: nothing usable in the recording";

  // Back up the live rows we replace, insert the new rows first, then remove the old ones by id.
  if (rows.length) {
    const backup = path.posix.join(recordingsDir, `round2-transcript-backup-${r.id}-${Date.now()}.json`);
    await supabaseAdmin.storage
      .from("recordings")
      .upload(backup, Buffer.from(JSON.stringify({ roundTwoId: r.id, savedAt: new Date().toISOString(), rows }, null, 2)), { contentType: "application/json" })
      .catch(() => undefined);
  }
  const { error: insErr } = await supabaseAdmin.from("round_two_transcript").insert(newRows.map((x) => ({ roundTwoId: r.id, ...x })));
  if (insErr) throw new Error(`Could not save the recording transcript: ${insErr.message}`);
  if (rows.length) {
    await supabaseAdmin.from("round_two_transcript").delete().eq("roundTwoId", r.id).in("id", rows.map((x) => x.id));
  }
  return `transcript rebuilt from the recording: ${newRows.filter((x) => x.speakerRole === "candidate").length} candidate + ${newRows.filter((x) => x.speakerRole === "interviewer").length} interviewer lines (${decision.reason}; engines: ${usageLabel})`;
}

/** Report step: wait for the last parts, save the recording, rebuild the transcript. Never throws. */
export async function prepareRoundTwoMedia(roundTwoId: string): Promise<string[]> {
  const notes: string[] = [];
  const r = await loadRoundMediaRow(roundTwoId);
  if (!r) return ["round not found"];
  let dirs: { recordings: string; images: string };
  try {
    dirs = await roundTwoMediaDirs(r);
    await waitForFinalParts(r, dirs.recordings);
  } catch (err) {
    return [`media skipped: ${err instanceof Error ? err.message : String(err)}`];
  }
  const keys = await listObjectKeys(`${dirs.recordings}/`).catch(() => [] as string[]);
  try {
    notes.push(await finalizeRoundTwoRecording(r, keys, dirs.recordings));
  } catch (err) {
    notes.push(`recording not saved: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  try {
    notes.push(await refineRoundTwoTranscript(r, keys, dirs.recordings));
  } catch (err) {
    notes.push(`transcript not rebuilt: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  log.info(`round 2 media ${roundTwoId}: ${notes.join(" · ")}`);
  return notes;
}

export type RoundTwoMediaView = {
  recording: { url: string } | null;
  /** Audio parts exist but the joined file isn't saved yet (report still running). */
  recordingPending: boolean;
  snapshots: { url: string; at: string }[];
};

/** Signed URLs for the report: the joined recording and the camera snapshots. */
export async function roundTwoMediaForView(r: RoundMediaRow): Promise<RoundTwoMediaView> {
  const dirs = await roundTwoMediaDirs(r);
  let recording: RoundTwoMediaView["recording"] = null;
  if (r.recordingUrl && r.recordingUrl.startsWith(`${dirs.recordings}/`)) {
    const { data } = await supabaseAdmin.storage.from("recordings").createSignedUrl(r.recordingUrl, SIGNED_URL_TTL_SEC);
    if (data?.signedUrl) recording = { url: data.signedUrl };
  }
  let recordingPending = false;
  if (!recording) {
    const keys = await listObjectKeys(`${dirs.recordings}/`).catch(() => [] as string[]);
    recordingPending = groupR2Parts(keys, r.id, "mix").length > 0;
  }
  const imageKeys = await listObjectKeys(`${dirs.images}/`).catch(() => [] as string[]);
  const shots = imageKeys
    .map((k) => parseR2SnapshotKey(k, r.id))
    .filter((x): x is { key: string; at: number } => !!x)
    .sort((a, b) => a.at - b.at)
    .slice(-R2_MAX_SNAPSHOTS);
  const snapshots: RoundTwoMediaView["snapshots"] = [];
  for (const s of shots) {
    const { data } = await supabaseAdmin.storage.from("images").createSignedUrl(s.key, SIGNED_URL_TTL_SEC);
    if (data?.signedUrl) snapshots.push({ url: data.signedUrl, at: new Date(s.at).toISOString() });
  }
  return { recording, recordingPending, snapshots };
}

/** Cheap counts for the report's integrity notes (no signed URLs). */
export async function roundTwoMediaStats(r: RoundMediaRow): Promise<{ snapshots: number; hasRecording: boolean }> {
  try {
    const dirs = await roundTwoMediaDirs(r);
    const [images, recs] = await Promise.all([
      listObjectKeys(`${dirs.images}/`).catch(() => [] as string[]),
      listObjectKeys(`${dirs.recordings}/`).catch(() => [] as string[]),
    ]);
    const fresh = await loadRoundMediaRow(r.id);
    return {
      snapshots: images.filter((k) => parseR2SnapshotKey(k, r.id)).length,
      hasRecording: !!fresh?.recordingUrl || groupR2Parts(recs, r.id, "mix").length > 0,
    };
  } catch {
    return { snapshots: 0, hasRecording: false };
  }
}
