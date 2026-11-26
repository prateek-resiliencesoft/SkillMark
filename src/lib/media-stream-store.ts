/**
 * Module-level store for MediaStreams that need to persist across
 * client-side page navigations (e.g., onboarding → interview session).
 *
 * The "skipped" flags track when the user explicitly skipped a check
 * during onboarding, so downstream code knows not to re-prompt.
 */

import { registerMediaTrack } from "@/lib/integrity/bus";

let cameraStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let cameraSkipped = false;
let screenSkipped = false;
const screenListeners = new Set<() => void>();

function notifyScreenListeners() {
  for (const fn of screenListeners) fn();
}

/** Subscribe to screen-share store changes (start, stop, or skip). */
export function subscribeScreenStream(listener: () => void): () => void {
  screenListeners.add(listener);
  return () => {
    screenListeners.delete(listener);
  };
}

export function setStoredCameraStream(stream: MediaStream | null) {
  cameraStream = stream;
  if (stream) {
    cameraSkipped = false;
    stream.getVideoTracks().forEach(registerMediaTrack);
  }
}

export function getStoredCameraStream(): MediaStream | null {
  if (cameraStream && cameraStream.active) return cameraStream;
  cameraStream = null;
  return null;
}

export function setCameraSkipped(skipped: boolean) {
  cameraSkipped = skipped;
}

export function wasCameraSkipped(): boolean {
  return cameraSkipped;
}

export function setStoredScreenStream(stream: MediaStream | null) {
  screenStream = stream;
  if (stream) screenSkipped = false;
  notifyScreenListeners();
}

export function getStoredScreenStream(): MediaStream | null {
  if (screenStream && screenStream.active) return screenStream;
  screenStream = null;
  return null;
}

export function setScreenSkipped(skipped: boolean) {
  screenSkipped = skipped;
  notifyScreenListeners();
}

export function wasScreenSkipped(): boolean {
  return screenSkipped;
}
