/**
 * Browser helper to start a screen share that meets the interview rules.
 * (The rules themselves live in screen-share.ts and are unit-tested.)
 */

import { mediaErrorCode } from "@/lib/preflight";
import {
  canUseDisplayMedia,
  displayMediaOptions,
  isAcceptableScreenShare,
  isLikelyMobileDevice,
} from "@/lib/screen-share";

export type ScreenShareRequestResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; kind: "denied" | "not_entire" | "unsupported" | "failed" };

export function currentDeviceIsMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return isLikelyMobileDevice(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints ?? 0 });
}

export async function requestInterviewScreenShare(): Promise<ScreenShareRequestResult> {
  if (typeof navigator === "undefined" || !canUseDisplayMedia(navigator.mediaDevices)) {
    return { ok: false, kind: "unsupported" };
  }
  const isMobile = currentDeviceIsMobile();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      displayMediaOptions() as DisplayMediaStreamOptions,
    );
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "OverconstrainedError") {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (err2) {
        return { ok: false, kind: mediaErrorCode(err2) === "permission_denied" ? "denied" : "failed" };
      }
    } else {
      return { ok: false, kind: mediaErrorCode(err) === "permission_denied" ? "denied" : "failed" };
    }
  }
  const surface = (stream.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string })
    ?.displaySurface;
  if (!isAcceptableScreenShare(surface, { isMobile })) {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, kind: "not_entire" };
  }
  return { ok: true, stream };
}
