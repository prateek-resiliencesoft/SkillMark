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

/** Latest strike state from the server (after each reported violation). */
export interface StrikeState {
  count: number;
  max: number;
  disqualified: boolean;
  lastReason: string | null;
}

type StrikeListener = (s: StrikeState) => void;
const strikeListeners = new Set<StrikeListener>();
let lastStrike: StrikeState | null = null;

export function publishStrike(s: StrikeState) {
  lastStrike = s;
  strikeListeners.forEach((l) => l(s));
}

/** Calls `l` with the latest state right away (if any), then on every update. */
export function subscribeStrikes(l: StrikeListener): () => void {
  strikeListeners.add(l);
  if (lastStrike) l(lastStrike);
  return () => { strikeListeners.delete(l); };
}

type NoticeListener = (text: string) => void;
const noticeListeners = new Set<NoticeListener>();

/** Text the AI should say aloud (voice interviews only). */
export function publishAiNotice(text: string) {
  noticeListeners.forEach((l) => l(text));
}

export function subscribeAiNotices(l: NoticeListener): () => void {
  noticeListeners.add(l);
  return () => { noticeListeners.delete(l); };
}
