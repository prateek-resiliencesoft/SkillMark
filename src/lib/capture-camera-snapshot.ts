import {
  STRIKE_LABEL,
  type LoggedViolation,
  type StrikeDisplayInfo,
  type StrikeEvidenceFields,
} from "@/lib/head-movement";
import { getStoredCameraStream, getStoredScreenStream } from "@/lib/media-stream-store";

const JPEG_QUALITY = 0.92;

async function frameFromStream(
  stream: MediaStream,
  opts?: { mirror?: boolean },
): Promise<Blob | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
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
    if (opts?.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
    );
  } catch {
    return null;
  } finally {
    video.srcObject = null;
    video.remove();
  }
}

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
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      ephemeral = true;
    } catch {
      return null;
    }
  }

  try {
    return await frameFromStream(stream, { mirror: true });
  } finally {
    if (ephemeral) stream.getTracks().forEach((t) => t.stop());
  }
}

/** One JPEG from the active shared screen stream (if still live). */
export async function captureScreenSnapshot(): Promise<Blob | null> {
  const stream = getStoredScreenStream();
  if (!stream) return null;
  return frameFromStream(stream);
}

export async function collectDisplayInfo(): Promise<StrikeDisplayInfo> {
  const base: StrikeDisplayInfo = {
    count: 1,
    capturedSharedOnly: true,
    screens: [
      {
        width: window.screen.width,
        height: window.screen.height,
        isPrimary: true,
      },
    ],
  };

  const getScreenDetails = (
    window as unknown as {
      getScreenDetails?: () => Promise<{
        screens: { label?: string; width: number; height: number; isPrimary?: boolean }[];
      }>;
    }
  ).getScreenDetails;

  if (getScreenDetails) {
    try {
      const details = await getScreenDetails();
      if (details.screens?.length) {
        return {
          count: details.screens.length,
          capturedSharedOnly: true,
          screens: details.screens.map((s) => ({
            label: s.label,
            width: s.width,
            height: s.height,
            isPrimary: s.isPrimary,
          })),
        };
      }
    } catch {
      /* permission denied — fall through */
    }
  }

  const screen = window.screen as Screen & { availLeft?: number };
  const multi =
    screen.availWidth > screen.width ||
    (screen.availLeft !== undefined && screen.availLeft !== 0);
  if (multi) {
    return {
      count: 2,
      capturedSharedOnly: true,
      screens: [
        { width: screen.width, height: screen.height, isPrimary: true },
        {
          width: Math.max(0, screen.availWidth - screen.width) || screen.width,
          height: screen.availHeight,
          isPrimary: false,
        },
      ],
    };
  }

  return base;
}

function displaysSummary(info: StrikeDisplayInfo): string {
  if (info.count <= 1) return "1 display detected";
  const parts = (info.screens ?? []).map((s, i) => {
    const name = s.label?.trim() || (s.isPrimary ? "Primary" : `Display ${i + 1}`);
    return `${name} ${s.width}×${s.height}`;
  });
  return `${info.count} displays connected${parts.length ? ` (${parts.join("; ")})` : ""} — screen pixels are from the shared display only`;
}

export function buildStrikeExplanation(input: {
  type: string;
  detail?: string;
  timestamp: number;
  strikeNumber: number;
  displayInfo: StrikeDisplayInfo;
  hasWebcam: boolean;
  hasScreen: boolean;
}): { evidence: StrikeEvidenceFields; narrative: string; detail: string } {
  const label = STRIKE_LABEL[input.type] ?? input.type;
  const whatDetected = input.detail?.trim() || label;
  const when = new Date(input.timestamp).toLocaleString();
  const attached = [
    input.hasWebcam ? "webcam" : null,
    input.hasScreen ? "shared screen" : null,
  ]
    .filter(Boolean)
    .join(" + ") || "none";

  const evidence: StrikeEvidenceFields = {
    type: label,
    when,
    whatDetected,
    strikeNumber: input.strikeNumber,
    displaysSummary: displaysSummary(input.displayInfo),
    evidenceAttached: attached,
  };

  const narrative = [
    `Strike ${input.strikeNumber} was applied because: ${whatDetected}.`,
    `Detected at ${when}.`,
    `Violation type: ${label} (${input.type}).`,
    evidence.displaysSummary + ".",
    input.hasScreen
      ? "At the same moment we captured the candidate webcam and a frame from the screen they shared during the interview."
      : input.hasWebcam
        ? "We captured the candidate webcam; no live screen share was available at that moment (skipped, ended, or not granted)."
        : "No webcam or screen frame could be captured at that moment.",
    "Only the shared display can be captured in the browser; other monitors appear as metadata when detectable.",
  ].join(" ");

  return { evidence, narrative, detail: whatDetected };
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

/**
 * Capture webcam + shared screen at the strike instant, upload both,
 * and build structured + narrative explanation for reviewers.
 */
export async function captureStrikeEvidence(opts: {
  sessionId: string;
  type: string;
  detail?: string;
  timestamp: number;
  strikeNumber: number;
  /** Prefer an already-grabbed webcam frame (e.g. MediaPipe). */
  webcamBlob?: Blob | null;
  prefix?: string;
}): Promise<Pick<
  LoggedViolation,
  | "imageUrl"
  | "imagePath"
  | "screenImageUrl"
  | "screenImagePath"
  | "displayInfo"
  | "evidence"
  | "narrative"
  | "detail"
>> {
  const prefix = opts.prefix ?? `strike-${opts.type}`;
  const [webcamBlob, screenBlob, displayInfo] = await Promise.all([
    opts.webcamBlob !== undefined ? Promise.resolve(opts.webcamBlob) : captureCameraSnapshot(),
    captureScreenSnapshot(),
    collectDisplayInfo(),
  ]);

  const emptyUpload: { imageUrl?: string; imagePath?: string } = {};
  const [camUpload, screenUpload] = await Promise.all([
    webcamBlob ? uploadStrikeSnapshot(opts.sessionId, webcamBlob, `${prefix}-cam`) : Promise.resolve(emptyUpload),
    screenBlob
      ? uploadStrikeSnapshot(opts.sessionId, screenBlob, `${prefix}-screen`)
      : Promise.resolve(emptyUpload),
  ]);

  const { evidence, narrative, detail } = buildStrikeExplanation({
    type: opts.type,
    detail: opts.detail,
    timestamp: opts.timestamp,
    strikeNumber: opts.strikeNumber,
    displayInfo,
    hasWebcam: !!camUpload.imageUrl,
    hasScreen: !!screenUpload.imageUrl,
  });

  return {
    imageUrl: camUpload.imageUrl,
    imagePath: camUpload.imagePath,
    screenImageUrl: screenUpload.imageUrl,
    screenImagePath: screenUpload.imagePath,
    displayInfo,
    evidence,
    narrative,
    detail,
  };
}
