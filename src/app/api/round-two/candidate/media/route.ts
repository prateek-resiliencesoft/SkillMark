import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { mimeForRecordingExt, recordingExtForMime } from "@/lib/recording-parts";
import {
  R2_MAX_PARTS_PER_TRACK,
  isR2AudioTrack,
  roundAcceptsMedia,
  r2PartFileName,
  r2SnapshotFileName,
} from "@/lib/round-two/recording";
import { rejectCrossSiteRequest } from "@/lib/session-access";
import { isStorageCapError, reserveSessionUpload } from "@/lib/storage-cap";
import { matchesMediaSignature } from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashRoundToken } from "@/server/round-two/access";
import { roundTwoMediaDirs, type RoundMediaRow } from "@/server/round-two/media";

export const dynamic = "force-dynamic";

const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PART_BYTES + 256 * 1024;

/**
 * Candidate-side round 2 media (no login; the candidate link token is the credential):
 *  - type=audio_part: one ~10 s slice of the mix / cand / panel track (see lib/round-two/recording.ts)
 *  - type=snapshot:   one camera JPEG
 * Stored in the candidate's media folder under recordings|images/round2-{id}/.
 */
export async function POST(req: Request) {
  const refused = rejectCrossSiteRequest(req);
  if (refused) return refused;
  const declared = Number(req.headers.get("content-length"));
  if (!req.headers.get("content-length") || !Number.isFinite(declared)) {
    return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
  }
  if (declared > MAX_REQUEST_BYTES) return NextResponse.json({ error: "Upload too large" }, { status: 413 });
  const limited = checkRateLimit(`r2:media:ip:${clientIp(req)}`, 120);
  if (limited) return limited;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  const token = form.get("token");
  const type = form.get("type");
  const file = form.get("file");
  if (typeof token !== "string" || token.length < 10 || token.length > 200 || !file || typeof file === "string") {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (type !== "audio_part" && type !== "snapshot") return NextResponse.json({ error: "Invalid type" }, { status: 400 });

  const { data } = await supabaseAdmin
    .from("round_two_interviews")
    .select('id, "organizationId", "projectId", "candidateId", "sourceSessionId", title, status, "startedAt", "endedAt", "recordingUrl", "candidateAdmittedAt"')
    .eq("candidateTokenHash", hashRoundToken(token))
    .maybeSingle();
  const round = data as RoundMediaRow | null;
  if (!round) return NextResponse.json({ error: "This interview link is not valid" }, { status: 404 });
  // 403 tells the browser recorder to stop trying (same contract as /api/session/upload).
  if (!roundAcceptsMedia(round)) return NextResponse.json({ error: "Interview is not running" }, { status: 403 });
  const roundLimited = checkRateLimit(`r2:media:${round.id}`, 90);
  if (roundLimited) return roundLimited;

  const max = type === "audio_part" ? MAX_PART_BYTES : MAX_SNAPSHOT_BYTES;
  if (file.size > max) return NextResponse.json({ error: "File too large" }, { status: 413 });
  const quota = reserveSessionUpload(`round2:${round.id}`, file.size);
  if (quota) return NextResponse.json({ error: quota }, { status: 429 });

  const dirs = await roundTwoMediaDirs(round);
  const buf = Buffer.from(await file.arrayBuffer());
  let bucket: "recordings" | "images";
  let key: string;
  let contentType: string;
  if (type === "audio_part") {
    const track = form.get("track");
    const runId = Number(form.get("runId"));
    const seq = Number(form.get("seq"));
    const elapsedSec = Number(form.get("elapsedSec"));
    if (!isR2AudioTrack(track) || !Number.isFinite(runId) || runId <= 0 || !Number.isInteger(seq) || seq < 0 || seq >= R2_MAX_PARTS_PER_TRACK || !Number.isFinite(elapsedSec)) {
      return NextResponse.json({ error: "Invalid part fields" }, { status: 400 });
    }
    const ext = recordingExtForMime(file.type);
    bucket = "recordings";
    key = `${dirs.recordings}/${r2PartFileName({ track, roundTwoId: round.id, runId, seq, elapsedSec, ext })}`;
    contentType = mimeForRecordingExt(ext);
  } else {
    if (!matchesMediaSignature(buf, "snapshot.jpg")) return NextResponse.json({ error: "Not an image" }, { status: 415 });
    bucket = "images";
    key = `${dirs.images}/${r2SnapshotFileName(round.id, Date.now())}`;
    contentType = "image/jpeg";
  }
  const { error } = await supabaseAdmin.storage.from(bucket).upload(key, buf, { contentType, upsert: false, liveSession: true });
  if (error && error.message === "The resource already exists") return NextResponse.json({ ok: true, duplicate: true });
  if (error) return NextResponse.json({ error: error.message }, { status: isStorageCapError(error.message) ? 507 : 500 });
  return NextResponse.json({ ok: true });
}
