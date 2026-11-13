import { createLogger } from "@/lib/logger";
import { candidateMediaPrefix, mediaObjectKey } from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { recordingExtForMime, recordingPartFileName } from "@/lib/recording-parts";
import { linkRecordingToSession } from "@/lib/recording-parts-server";
import { recordSessionError } from "@/lib/session-error-log-server";

const log = createLogger("api/session/upload");

/**
 * Upload recording / screenshot for an active session.
 * Keys: orgs/{org}/projects/{project}/candidates/{candidate}/{kind}/{file}
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as Blob | null;
    const sessionId = formData.get("sessionId") as string | null;
    const type = formData.get("type") as string | null;
    const filename = formData.get("filename") as string | null;

    if (!file || !sessionId || !type) {
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

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select(
        `id, status, mediaStoragePrefix,
         interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
      )
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Allow finalize uploads after complete/disqualify (stop-recording races complete).
    if (session.status === "ABANDONED") {
      return NextResponse.json({ error: "Session has ended" }, { status: 403 });
    }

    const interview = session.interview as unknown as {
      id: string;
      projectId: string;
      project: { id: string; organizationId: string };
    };

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id")
      .eq("sessionId", sessionId)
      .maybeSingle();

    // Fallback folder when no candidate row linked yet
    const subjectId = candidate?.id || `session-${sessionId}`;
    const orgId = interview.project.organizationId;
    const projectId = interview.projectId;

    const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
    const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
    const MAX_PART_BYTES = 10 * 1024 * 1024;
    const maxBytes =
      type === "recording" ? MAX_RECORDING_BYTES : type === "recording_part" ? MAX_PART_BYTES : MAX_SCREENSHOT_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size (${maxBytes / (1024 * 1024)}MB)` },
        { status: 413 },
      );
    }

    // Chunk uploaded during the interview (joined by /api/session/recording/finalize).
    if (type === "recording_part") {
      const runId = Number(formData.get("runId"));
      const seq = Number(formData.get("seq"));
      const elapsedSec = Number(formData.get("elapsedSec"));
      if (!Number.isFinite(runId) || runId <= 0 || !Number.isInteger(seq) || seq < 0 || !Number.isFinite(elapsedSec)) {
        return NextResponse.json({ error: "Invalid part fields" }, { status: 400 });
      }
      const partKey = mediaObjectKey({
        orgId,
        projectId,
        candidateId: subjectId,
        kind: "recordings",
        fileName: recordingPartFileName({ sessionId, runId, seq, elapsedSec, ext: recordingExtForMime(file.type) }),
      });
      const { error: partErr } = await supabaseAdmin.storage
        .from("recordings")
        .upload(partKey, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type || "application/octet-stream",
          upsert: true, // retries of the same part are safe
        });
      if (partErr) {
        log.error("Storage error: recording part", partErr);
        return NextResponse.json({ error: partErr.message }, { status: 500 });
      }
      if (!session.mediaStoragePrefix) {
        await supabaseAdmin
          .from("sessions")
          .update({ mediaStoragePrefix: candidateMediaPrefix({ orgId, projectId, candidateId: subjectId }) })
          .eq("id", sessionId);
      }
      return NextResponse.json({ ok: true, path: partKey });
    }

    const kind = type === "recording" ? "recordings" : "screenshots";
    const defaultExt =
      type === "recording"
        ? file.type?.includes("mp4") || file.type?.includes("m4a")
          ? "m4a"
          : "webm"
        : "jpg";
    const cleanFilename = (filename || `${Date.now()}.${defaultExt}`)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".");

    const storagePath = mediaObjectKey({
      orgId,
      projectId,
      candidateId: subjectId,
      kind,
      fileName: cleanFilename,
    });
    const prefix = candidateMediaPrefix({ orgId, projectId, candidateId: subjectId });

    const buffer = Buffer.from(await file.arrayBuffer());
    const defaultContentType =
      type === "recording"
        ? file.type?.includes("mp4")
          ? "audio/mp4"
          : "audio/webm"
        : "image/jpeg";

    const { error: uploadError } = await supabaseAdmin.storage
      .from(kind)
      .upload(storagePath, buffer, {
        contentType: file.type || defaultContentType,
        upsert: false,
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
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
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
