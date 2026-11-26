import { createLogger } from "@/lib/logger";
import {
  candidateMediaPrefix,
  matchesMediaSignature,
  mediaContentType,
  mediaObjectKey,
  mediaUploadFileName,
} from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { mimeForRecordingExt, recordingExtForMime, recordingPartFileName } from "@/lib/recording-parts";
import {
  linkRecordingToSession,
  linkScreenshotToSession,
  periodicScreenshotType,
} from "@/lib/recording-parts-server";
import { recordSessionError } from "@/lib/session-error-log-server";
import { isLiveInterviewUpload, isStorageCapError, reserveSessionUpload } from "@/lib/storage-cap";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { candidateWriteWindow } from "@/lib/session-link";
import { CANDIDATE_SESSION_GATE_COLUMNS, gateCandidateSession, rejectCrossSiteRequest } from "@/lib/session-access";

const log = createLogger("api/session/upload");

/**
 * Upload recording / screenshot for an active session.
 * Keys: orgs/{org}/projects/{project}/candidates/{candidate}/{kind}/{file}
 */
const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_PART_BYTES = 10 * 1024 * 1024;
/** Multipart framing + text fields on top of the largest file. */
const MAX_REQUEST_BYTES = MAX_RECORDING_BYTES + 1024 * 1024;

export async function POST(req: Request) {
  try {
    const refused = rejectCrossSiteRequest(req);
    if (refused) return refused;
    // Reject before req.formData() buffers the whole body in memory.
    const declared = Number(req.headers.get("content-length"));
    if (!req.headers.get("content-length") || !Number.isFinite(declared)) {
      return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
    }
    if (declared > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Upload too large" }, { status: 413 });
    }
    const limited = checkRateLimit(`session:upload-ip:${clientIp(req)}`, 600);
    if (limited) return limited;

    const formData = await req.formData();
    const file = formData.get("file") as Blob | null;
    const sessionId = formData.get("sessionId") as string | null;
    const type = formData.get("type") as string | null;
    const filename = formData.get("filename") as string | null;

    if (!file || typeof file === "string" || !sessionId || !type) {
      return NextResponse.json(
        { error: "Missing required fields: file, sessionId, type" },
        { status: 400 },
      );
    }

    if (type !== "recording" && type !== "screenshot" && type !== "recording_part") {
      return NextResponse.json(
        { error: 'type must be "recording", "recording_part" or "screenshot"' },
        { status: 400 },
      );
    }

    const sessionLimited = checkRateLimit(`session:upload:${sessionId}`, 60);
    if (sessionLimited) return sessionLimited;

    const gate = await gateCandidateSession(
      req,
      sessionId,
      `${CANDIDATE_SESSION_GATE_COLUMNS}, mediaStoragePrefix, mediaClearedAt, participantName, participantEmail,
       interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
    );
    if (!gate.ok) return gate.response;
    const session = gate.session;

    // Live interview (incl. pre-flight photo), or the short finalize window after
    // complete/disqualify (stop-recording races complete). Never after a wipe.
    const live =
      session.status === "IN_PROGRESS"
        ? candidateWriteWindow(session, { inviteExpiresAt: gate.invite?.expiresAt }) === "live"
        : !session.supersededAt && isLiveInterviewUpload(session);
    if (!live || session.mediaClearedAt) {
      return NextResponse.json({ error: "Session has ended" }, { status: 403 });
    }

    const maxBytes =
      type === "recording" ? MAX_RECORDING_BYTES : type === "recording_part" ? MAX_PART_BYTES : MAX_SCREENSHOT_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size (${maxBytes / (1024 * 1024)}MB)` },
        { status: 413 },
      );
    }
    const quota = reserveSessionUpload(session.id, file.size);
    if (quota) return NextResponse.json({ error: quota }, { status: 429 });

    const interview = session.interview as unknown as {
      id: string;
      projectId: string;
      project: { id: string; organizationId: string };
    };

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id, name, email")
      .eq("sessionId", sessionId)
      .maybeSingle();

    // Fallback folder when no candidate row linked yet
    const candidateName =
      (candidate?.name as string | undefined) ||
      ((session as unknown as { participantName?: string }).participantName as
        | string
        | undefined);
    const candidateEmail =
      (candidate?.email as string | null | undefined) ||
      ((session as unknown as { participantEmail?: string | null }).participantEmail ?? null);
    const subjectId = candidate?.id || `session-${sessionId}`;
    // A session keeps writing into the folder it was assigned, so one person = one folder.
    const folderPrefix = (session.mediaStoragePrefix as string | null) || null;
    const orgId = interview.project.organizationId;
    const projectId = interview.projectId;

    // Chunk uploaded during the interview (joined by /api/session/recording/finalize).
    if (type === "recording_part") {
      const runId = Number(formData.get("runId"));
      const seq = Number(formData.get("seq"));
      const elapsedSec = Number(formData.get("elapsedSec"));
      if (!Number.isFinite(runId) || runId <= 0 || !Number.isInteger(seq) || seq < 0 || !Number.isFinite(elapsedSec)) {
        return NextResponse.json({ error: "Invalid part fields" }, { status: 400 });
      }
      const partExt = recordingExtForMime(file.type);
      const partKey = mediaObjectKey({
        orgId,
        projectId,
        candidateId: subjectId,
        candidateName,
        candidateEmail,
        prefix: folderPrefix,
        kind: "recordings",
        fileName: recordingPartFileName({ sessionId, runId, seq, elapsedSec, ext: partExt }),
      });
      const { error: partErr } = await supabaseAdmin.storage
        .from("recordings")
        .upload(partKey, Buffer.from(await file.arrayBuffer()), {
          contentType: mimeForRecordingExt(partExt),
          // Stored parts are immutable; a retry of a part that already landed is a no-op.
          upsert: false,
          liveSession: true,
        });
      if (partErr && partErr.message === "The resource already exists") {
        return NextResponse.json({ ok: true, path: partKey, duplicate: true });
      }
      if (partErr) {
        log.error("Storage error: recording part", partErr);
        return NextResponse.json({ error: partErr.message }, { status: isStorageCapError(partErr.message) ? 507 : 500 });
      }
      if (!session.mediaStoragePrefix) {
        await supabaseAdmin
          .from("sessions")
          .update({
            mediaStoragePrefix: candidateMediaPrefix({
              orgId,
              projectId,
              candidateId: subjectId,
              candidateName,
              candidateEmail,
            }),
          })
          .eq("id", sessionId);
      }
      return NextResponse.json({ ok: true, path: partKey });
    }

    const kind = type === "recording" ? "recordings" : "images";
    const defaultExt =
      type === "recording"
        ? file.type?.includes("mp4") || file.type?.includes("m4a")
          ? "m4a"
          : "webm"
        : "jpg";
    const cleanFilename = mediaUploadFileName(filename, type, `${Date.now()}.${defaultExt}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesMediaSignature(buffer, cleanFilename)) {
      return NextResponse.json({ error: "File content does not match its type" }, { status: 415 });
    }

    const storagePath = mediaObjectKey({
      orgId,
      projectId,
      candidateId: subjectId,
      candidateName,
      candidateEmail,
      prefix: folderPrefix,
      kind,
      fileName: cleanFilename,
    });
    const prefix =
      folderPrefix ||
      candidateMediaPrefix({
        orgId,
        projectId,
        candidateId: subjectId,
        candidateName,
        candidateEmail,
      });

    const { error: uploadError } = await supabaseAdmin.storage
      .from(kind)
      .upload(storagePath, buffer, {
        contentType: mediaContentType(cleanFilename),
        upsert: false,
        liveSession: true,
      });

    if (uploadError) {
      log.error("Storage error:", kind, uploadError);
      if (type === "recording") {
        void recordSessionError({
          sessionId,
          category: "client",
          severity: "error",
          source: "api/session/upload",
          message: `Recording upload could not be stored: ${uploadError.message}`,
          context: { stage: "recording_upload", bytes: file.size },
        });
      }
      return NextResponse.json(
        { error: uploadError.message },
        { status: isStorageCapError(uploadError.message) ? 507 : 500 },
      );
    }

    if (!session.mediaStoragePrefix) {
      await supabaseAdmin
        .from("sessions")
        .update({ mediaStoragePrefix: prefix })
        .eq("id", sessionId);
    }

    // Link the recording here, server-side. The browser used to do this in a
    // second call after the upload, which was skipped when its 15s timer ran
    // out while the upload was still finishing (recording stored, never linked).
    let linked: boolean | undefined;
    if (type === "recording") {
      const durRaw = Number(formData.get("audioDuration"));
      linked = await linkRecordingToSession(sessionId, storagePath, Number.isFinite(durRaw) ? durRaw : null);
      if (linked) log.info(`Recording linked to session ${sessionId}`);
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(kind)
      .createSignedUrl(storagePath, 60 * 60 * 24);

    if (signedError || !signedData?.signedUrl) {
      log.error("Signed URL error:", kind, signedError);
      return NextResponse.json({ error: "Failed to generate signed URL" }, { status: 500 });
    }

    // Periodic proctoring captures: link on the server so they show in the report
    // even if the browser's end-of-interview save never lands.
    if (type === "screenshot") {
      const shotType = periodicScreenshotType(cleanFilename);
      if (shotType) {
        await linkScreenshotToSession(sessionId, {
          url: signedData.signedUrl,
          path: storagePath,
          timestamp: new Date().toISOString(),
          type: shotType,
        });
      }
    }

    return NextResponse.json({
      url: signedData.signedUrl,
      path: storagePath,
      bucket: kind,
      prefix,
      ...(linked !== undefined ? { linked } : {}),
    });
  } catch (err) {
    log.error("Unexpected error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  }
}
