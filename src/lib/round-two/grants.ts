/**
 * LiveKit grants per Round 2 participant kind (pure, unit-tested).
 * Admitted candidates and panelists may publish data (the shared editor's live
 * packets); observers watch with camera / mic only (no screen share, no data);
 * the lobby and the hidden transcription agent publish nothing.
 */
import { TrackSource, type VideoGrant } from "livekit-server-sdk";

export type RoomGrantKind = "panel" | "observer" | "candidate_lobby" | "candidate" | "agent";

const ALL_SOURCES = [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

export function roomGrant(kind: RoomGrantKind, room: string): VideoGrant {
  const base = { roomJoin: true, room, canPublishData: false };
  switch (kind) {
    case "panel":
      return { ...base, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ALL_SOURCES };
    case "observer":
      return { ...base, canPublish: true, canSubscribe: true, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] };
    case "candidate":
      return { ...base, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ALL_SOURCES };
    case "candidate_lobby":
      return { ...base, canPublish: false, canSubscribe: false };
    case "agent":
      return { ...base, canPublish: false, canSubscribe: true, hidden: true };
  }
}

/** Permission applied when the host admits the candidate from the lobby. */
export function admittedCandidatePermission() {
  return { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ALL_SOURCES };
}
