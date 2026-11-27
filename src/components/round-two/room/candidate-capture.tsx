"use client";

import { useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { createMicTrackRecorder, type MicTrackRecorder } from "@/lib/mic-track-recorder";
import { R2_FIRST_SNAPSHOT_MS, R2_SNAPSHOT_INTERVAL_MS, type R2AudioTrack } from "@/lib/round-two/recording";

const MEDIA_API = "/api/round-two/candidate/media";
const SNAPSHOT_MAX_WIDTH = 1280;
const SNAPSHOT_QUALITY = 0.85;

type Graph = {
  ctx: AudioContext;
  dest: Record<R2AudioTrack, MediaStreamAudioDestinationNode>;
  recorders: Record<R2AudioTrack, MicTrackRecorder>;
  sources: Map<string, MediaStreamAudioSourceNode>;
};

/** One JPEG frame from a live camera track (scaled down), or null. */
async function grabFrame(track: MediaStreamTrack): Promise<Blob | null> {
  if (track.readyState !== "live" || !track.enabled) return null;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  try {
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
        setTimeout(resolve, 1000);
      });
    }
    if (!video.videoWidth) return null;
    const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", SNAPSHOT_QUALITY));
  } catch {
    return null;
  } finally {
    video.srcObject = null;
    video.remove();
  }
}

/**
 * Candidate side of round 2, like round 1's recording: while admitted, records
 *  - mix:   the candidate's mic + everything they hear (playback in the report),
 *  - cand:  the candidate's mic only (candidate lines of the transcript),
 *  - panel: what they hear (interviewer / AI lines of the transcript),
 * uploading ~10 s parts, and takes a camera snapshot at the start and every minute.
 * Strictly best-effort: nothing here can break or slow the call.
 */
export function useRoundTwoCandidateCapture(linkToken: string, enabled: boolean) {
  const { microphoneTrack, cameraTrack } = useLocalParticipant();
  const remoteAudio = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], { onlySubscribed: true });
  const graph = useRef<Graph | null>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof MediaRecorder === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    const mk = (track: R2AudioTrack) =>
      createMicTrackRecorder("", { url: MEDIA_API, fields: { token: linkToken, type: "audio_part", track } });
    const dest = { mix: ctx.createMediaStreamDestination(), cand: ctx.createMediaStreamDestination(), panel: ctx.createMediaStreamDestination() };
    const recorders = { mix: mk("mix"), cand: mk("cand"), panel: mk("panel") };
    (Object.keys(dest) as R2AudioTrack[]).forEach((k) => recorders[k].start(dest[k].stream));
    graph.current = { ctx, dest, recorders, sources: new Map() };
    setReady((n) => n + 1);

    // The join click already unlocked audio on this page; resume again on any later gesture just in case.
    const resume = () => {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    resume();
    const flush = () => {
      if (document.visibilityState === "hidden") Object.values(recorders).forEach((r) => r.flush());
    };
    const flushNow = () => Object.values(recorders).forEach((r) => r.flush());
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flushNow);
      const g = graph.current;
      graph.current = null;
      void Promise.all(Object.values(recorders).map((r) => r.stop(8_000))).finally(() => {
        g?.sources.forEach((n) => {
          try {
            n.disconnect();
          } catch {
            /* noop */
          }
        });
        void ctx.close().catch(() => {});
      });
    };
  }, [enabled, linkToken]);

  // Keep the audio graph in step with the tracks: the candidate's mic → mix + cand; everyone else → mix + panel.
  const mic = microphoneTrack?.track?.mediaStreamTrack;
  const remote = remoteAudio
    .filter((ref) => !ref.participant.isLocal)
    .map((ref) => ref.publication?.track?.mediaStreamTrack)
    .filter((t): t is MediaStreamTrack => !!t);
  const wantKey = [mic?.id ?? "", ...remote.map((t) => t.id)].join("|");
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    const want = new Map<string, { track: MediaStreamTrack; local: boolean }>();
    if (mic && mic.readyState === "live") want.set(`local:${mic.id}`, { track: mic, local: true });
    for (const t of remote) if (t.readyState === "live") want.set(`remote:${t.id}`, { track: t, local: false });
    for (const [id, node] of g.sources) {
      if (want.has(id)) continue;
      try {
        node.disconnect();
      } catch {
        /* noop */
      }
      g.sources.delete(id);
    }
    for (const [id, w] of want) {
      if (g.sources.has(id)) continue;
      try {
        const node = g.ctx.createMediaStreamSource(new MediaStream([w.track]));
        node.connect(g.dest.mix);
        node.connect(w.local ? g.dest.cand : g.dest.panel);
        g.sources.set(id, node);
      } catch {
        /* a track that can't be read is just not recorded */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wantKey covers mic + remote track identity
  }, [wantKey, ready]);

  // Camera snapshots (proctoring evidence, like round 1's periodic captures).
  const camRef = useRef<MediaStreamTrack | undefined>(undefined);
  camRef.current = cameraTrack && !cameraTrack.isMuted ? cameraTrack.track?.mediaStreamTrack : undefined;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const shoot = async () => {
      const track = camRef.current;
      if (stopped || !track) return;
      const blob = await grabFrame(track);
      if (!blob || stopped) return;
      const form = new FormData();
      form.append("token", linkToken);
      form.append("type", "snapshot");
      form.append("file", blob, "snapshot.jpg");
      try {
        const res = await fetch(MEDIA_API, { method: "POST", body: form });
        if (res.status === 403) stopped = true;
      } catch {
        /* next one */
      }
    };
    const first = setTimeout(() => void shoot(), R2_FIRST_SNAPSHOT_MS);
    const timer = setInterval(() => void shoot(), R2_SNAPSHOT_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, linkToken]);
}
