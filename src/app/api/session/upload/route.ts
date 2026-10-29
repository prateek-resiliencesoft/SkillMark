import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const log = createLogger("api/session/upload");

/**
 * Upload a file (audio recording or screenshot) to Supabase Storage.
 *
 * Expects multipart FormData with:
 *   - file: Blob/File
 *   - sessionId: string
 *   - type: "recording" | "screenshot"
 *   - filename: string (optional, used as the storage path suffix)
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

    if (type !== "recording" && type !== "screenshot") {
      return NextResponse.json(
        { error: 'type must be "recording" or "screenshot"' },
        { status: 400 },
      );
    }

    // Enforce active session verification
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status === "COMPLETED" || session.status === "DISQUALIFIED") {
      return NextResponse.json({ error: "Session has ended" }, { status: 403 });
    }

    // Enforce upload size caps
    const MAX_RECORDING_BYTES = 100 * 1024 * 1024; // 100 MB
    const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
    const maxBytes = type === "recording" ? MAX_RECORDING_BYTES : MAX_SCREENSHOT_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size (${maxBytes / (1024 * 1024)}MB)` },
        { status: 413 },
      );
    }

    const bucket = type === "recording" ? "recordings" : "screenshots";
    const defaultExt = type === "recording"
      ? (file.type?.includes("mp4") || file.type?.includes("m4a") ? "m4a" : "webm")
      : "jpg";
    const cleanFilename = (filename || `${Date.now()}.${defaultExt}`)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".");
    const storagePath = `${sessionId}/${cleanFilename}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const defaultContentType = type === "recording"
      ? (file.type?.includes("mp4") ? "audio/mp4" : "audio/webm")
      : "image/jpeg";

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type || defaultContentType,
        upsert: false,
      });

    if (uploadError) {
      log.error("Storage error:", bucket, uploadError);
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 },
      );
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24); // 24 hours

    if (signedError || !signedData?.signedUrl) {
      log.error("Signed URL error:", bucket, signedError);
      return NextResponse.json(
        { error: "Failed to generate signed URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      url: signedData.signedUrl,
      path: storagePath,
      bucket,
    });
  } catch (err) {
    log.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 },
    );
  }
}
