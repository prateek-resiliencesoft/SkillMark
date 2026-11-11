import { getStoredCameraStream } from "@/lib/media-stream-store";

/**
 * Grab one JPEG frame from the live webcam (stored onboarding stream,
 * or a short getUserMedia fallback). Used for anti-cheat strike evidence.
 */
export async function captureCameraSnapshot(): Promise<Blob | null> {
  let stream = getStoredCameraStream();
  let ephemeral = false;
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      ephemeral = true;
    } catch {
      return null;
    }
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
    // Wait one frame so dimensions are real
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) return resolve();
      video.onloadeddata = () => resolve();
      setTimeout(() => resolve(), 800);
    });
    if (!video.videoWidth) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8),
    );
  } catch {
    return null;
  } finally {
    video.srcObject = null;
    video.remove();
    if (ephemeral) stream.getTracks().forEach((t) => t.stop());
  }
}

/** Upload a strike snapshot via the session upload API. */
export async function uploadStrikeSnapshot(
  sessionId: string,
  blob: Blob,
  prefix: string,
): Promise<{ imageUrl?: string; imagePath?: string }> {
  const timestamp = Date.now();
  const fd = new FormData();
  fd.append("file", blob, `${prefix}-${timestamp}.jpg`);
  fd.append("sessionId", sessionId);
  fd.append("type", "screenshot");
  fd.append("filename", `${prefix}-${timestamp}.jpg`);
  const r = await fetch("/api/session/upload", { method: "POST", body: fd });
  if (!r.ok) return {};
  const j = await r.json();
  return { imageUrl: j.url as string | undefined, imagePath: j.path as string | undefined };
}
