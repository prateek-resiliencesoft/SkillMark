/**
 * In-page channel between existing media owners (head tracker, voice hook)
 * and the integrity guard, so it needs no second camera stream or face model.
 */

export interface FaceFrame {
  t: number;
  faces: number;
  yaw: number | null;
  jawOpen: number | null;
  smile: number | null;
  gazeX: number | null;
}

type FrameListener = (f: FaceFrame) => void;
type TrackListener = (track: MediaStreamTrack) => void;

const frameListeners = new Set<FrameListener>();
const trackListeners = new Set<TrackListener>();
const tracks = new Set<MediaStreamTrack>();
let aiSpeaking = false;

export function publishFaceFrame(f: FaceFrame) {
  frameListeners.forEach((l) => l(f));
}

export function subscribeFaceFrames(l: FrameListener): () => void {
  frameListeners.add(l);
  return () => { frameListeners.delete(l); };
}

/** Camera / mic tracks the interview actually uses (not merely installed devices). */
export function registerMediaTrack(track: MediaStreamTrack) {
  if (tracks.has(track)) return;
  tracks.add(track);
  track.addEventListener("ended", () => tracks.delete(track), { once: true });
  trackListeners.forEach((l) => l(track));
}

export function subscribeMediaTracks(l: TrackListener): () => void {
  trackListeners.add(l);
  tracks.forEach((t) => l(t));
  return () => { trackListeners.delete(l); };
}

export function setAiSpeaking(v: boolean) {
  aiSpeaking = v;
}

export function isAiSpeaking() {
  return aiSpeaking;
}
