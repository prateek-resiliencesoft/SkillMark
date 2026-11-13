"use client";

import { createLogger } from "@/lib/logger";
import {
    getStoredCameraStream,
    getStoredScreenStream,
    setStoredCameraStream,
    setStoredScreenStream,
    wasCameraSkipped,
    wasScreenSkipped,
} from "@/lib/media-stream-store";
import fixWebmDuration from "fix-webm-duration";
import { reportSessionError } from "@/lib/session-error-report-client";
import { useCallback, useEffect, useRef, useState } from "react";

const log = createLogger("recording");

/** Upload recorded audio to the server every ~10s so nothing is lost if the tab closes or the final upload is slow. */
const PART_UPLOAD_INTERVAL_MS = 10_000;
/** ~48 kbps keeps a 15-min interview around 5 MB (speech stays clear). */
const RECORDING_BITRATE = 48_000;
/** keepalive fetch bodies must stay under ~64 KB. */
const KEEPALIVE_MAX_BYTES = 60_000;

type PendingPart = { seq: number; blob: Blob; elapsedSec: number; attempts: number };

export interface ScreenshotEntry {
  url: string;
  path: string;
  timestamp: string;
  type: "camera" | "screen";
}

interface UseInterviewRecordingOptions {
  sessionId: string;
  enabled: boolean;
  /** When false, record audio only (no camera/screen prompts or screenshots). */
  captureVideo?: boolean;
  screenshotIntervalMs?: number;
}

/**
 * Resolve the actual playable duration of a WebM audio blob.
 * WebM files from MediaRecorder often have Infinity/missing duration;
 * the seek-to-end trick forces the browser to compute it.
 */
function resolveBlobDuration(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); resolve(undefined); }
    }, 5000);

    function cleanup() {
      clearTimeout(timeout);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }

    function finish(dur: number) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(Math.round(dur));
    }

    audio.addEventListener("durationchange", () => {
      if (audio.duration && isFinite(audio.duration)) {
        finish(audio.duration);
      }
    });

    audio.addEventListener("loadedmetadata", () => {
      if (audio.duration && isFinite(audio.duration)) {
        finish(audio.duration);
      } else {
        audio.currentTime = 1e10;
      }
    });

    audio.preload = "auto";
    audio.src = url;
  });
}

/**
 * Manages audio recording (combined mic + TTS), camera/screen streams,
 * and periodic screenshot capture during a voice interview.
 *
 * Audio mixing strategy:
 *   - A single AudioContext drives a MediaStreamAudioDestinationNode.
 *   - The mic MediaStream is piped in via createMediaStreamSource.
 *   - TTS PCM chunks (float32 @ 24 kHz) are decoded into AudioBuffers
 *     and played into the same destination via BufferSourceNodes.
 *   - MediaRecorder records the destination's combined stream as webm/opus.
 */
export function useInterviewRecording({
  sessionId,
  enabled,
  captureVideo = true,
  screenshotIntervalMs = 60_000,
}: UseInterviewRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Refs for recording infrastructure
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioMimeRef = useRef<string>("");
  const mixCtxRef = useRef<AudioContext | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotsRef = useRef<ScreenshotEntry[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const ttsPlayTimeRef = useRef(0);
  const ttsSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  // Chunked upload state (see uploadParts)
  const runIdRef = useRef(0);
  const partSeqRef = useRef(0);
  const recordStartedAtRef = useRef(0);
  const unsentChunksRef = useRef<Blob[]>([]);
  const partQueueRef = useRef<PendingPart[]>([]);
  const partUploadingRef = useRef(false);
  const partTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const partsUploadedRef = useRef(0);
  const partFailureReportedRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { cameraStreamRef.current = cameraStream; }, [cameraStream]);
  useEffect(() => { screenStreamRef.current = screenStream; }, [screenStream]);

  /** Acquire camera and screen streams, reusing stored streams from onboarding. */
  const acquireStreams = useCallback(async () => {
    // Reuse camera stream from onboarding if still active
    const storedCam = getStoredCameraStream();
    if (storedCam) {
      setCameraStream(storedCam);
      cameraStreamRef.current = storedCam;
      setStoredCameraStream(null);
    } else if (!wasCameraSkipped()) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });
        setCameraStream(cam);
        cameraStreamRef.current = cam;
      } catch (err) {
        log.warn("Camera not available:", err);
      }
    }

    // Reuse screen stream from onboarding if still active
    const storedScreen = getStoredScreenStream();
    if (storedScreen) {
      setScreenStream(storedScreen);
      screenStreamRef.current = storedScreen;
      setStoredScreenStream(null);

      storedScreen.getVideoTracks()[0]?.addEventListener("ended", () => {
        setScreenStream(null);
        screenStreamRef.current = null;
      });
    } else if (!wasScreenSkipped()) {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        setScreenStream(screen);
        screenStreamRef.current = screen;

        screen.getVideoTracks()[0]?.addEventListener("ended", () => {
          setScreenStream(null);
          screenStreamRef.current = null;
        });
      } catch (err) {
        log.warn("Screen share not available:", err);
      }
    }
  }, []);

  /** Pipe a mic MediaStream into the recording mixer. */
  const attachMicStream = useCallback((micStream: MediaStream) => {
    const ctx = mixCtxRef.current;
    if (!ctx || !mixDestRef.current) return;

    // Disconnect previous mic source if any
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }

    const source = ctx.createMediaStreamSource(micStream);
    source.connect(mixDestRef.current);
    micSourceRef.current = source;
  }, []);

  /**
   * Feed a TTS PCM chunk (float32 @ 24 kHz) into the recording mixer.
   * Chunks are scheduled sequentially to avoid overlapping audio.
   */
  const addTtsChunk = useCallback((pcmData: ArrayBuffer) => {
    const ctx = mixCtxRef.current;
    const dest = mixDestRef.current;
    if (!ctx || !dest || pcmData.byteLength === 0) return;

    const float32 = new Float32Array(pcmData);
    const sampleRate = 24000;
    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    const startAt = Math.max(ctx.currentTime, ttsPlayTimeRef.current);
    source.start(startAt);
    ttsPlayTimeRef.current = startAt + audioBuffer.duration;

    ttsSourcesRef.current.push(source);
    source.onended = () => {
      ttsSourcesRef.current = ttsSourcesRef.current.filter((s) => s !== source);
    };
  }, []);

  /**
   * Cancel all scheduled TTS sources in the recording mixer.
   * Must be called when the user interrupts the agent so the recording
   * only contains audio that was actually heard.
   */
  const cancelTts = useCallback(() => {
    for (const source of ttsSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    ttsSourcesRef.current = [];
    ttsPlayTimeRef.current = 0;
  }, []);

  /** Capture a screenshot from a video element and upload it. */
  const captureAndUpload = useCallback(
    async (video: HTMLVideoElement, type: "camera" | "screen") => {
      if (video.readyState < 2 || video.videoWidth === 0) return;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;

      if (type === "camera") {
        ctx2d.translate(canvas.width, 0);
        ctx2d.scale(-1, 1);
      }
      ctx2d.drawImage(video, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7),
      );
      if (!blob) return;

      const timestamp = new Date().toISOString();
      const filename = `${timestamp.replace(/[:.]/g, "-")}-${type}.jpg`;

      try {
        const form = new FormData();
        form.append("file", blob, filename);
        form.append("sessionId", sessionId);
        form.append("type", "screenshot");
        form.append("filename", filename);

        const res = await fetch("/api/session/upload", {
          method: "POST",
          body: form,
        });

        if (res.ok) {
          const data = await res.json();
          screenshotsRef.current.push({
            url: data.url,
            path: data.path,
            timestamp,
            type,
          });
          log.info(`Screenshot uploaded: ${type}`);
        }
      } catch (err) {
        log.error("Screenshot upload failed:", err);
      }
    },
    [sessionId],
  );

  /** Take screenshots from both camera and screen streams. */
  const takeScreenshots = useCallback(() => {
    if (cameraVideoRef.current && cameraStreamRef.current) {
      captureAndUpload(cameraVideoRef.current, "camera");
    }
    if (screenVideoRef.current && screenStreamRef.current) {
      captureAndUpload(screenVideoRef.current, "screen");
    }
  }, [captureAndUpload]);

  /** Move recorded-but-unsent slices into the upload queue as one numbered part. */
  const cutPart = useCallback(() => {
    if (!unsentChunksRef.current.length) return;
    const blob = new Blob(unsentChunksRef.current, { type: audioMimeRef.current || "audio/webm" });
    unsentChunksRef.current = [];
    partQueueRef.current.push({
      seq: partSeqRef.current++,
      blob,
      elapsedSec: Math.max(0, (Date.now() - recordStartedAtRef.current) / 1000),
      attempts: 0,
    });
  }, []);

  const postPart = useCallback(
    async (part: PendingPart, keepalive = false): Promise<boolean> => {
      const form = new FormData();
      form.append("file", part.blob, `part-${part.seq}`);
      form.append("sessionId", sessionId);
      form.append("type", "recording_part");
      form.append("runId", String(runIdRef.current));
      form.append("seq", String(part.seq));
      form.append("elapsedSec", String(Math.round(part.elapsedSec)));
      try {
        const res = await fetch("/api/session/upload", { method: "POST", body: form, keepalive });
        return res.ok;
      } catch {
        return false;
      }
    },
    [sessionId],
  );

  /** Upload queued parts in order; a failed part stays at the head and is retried (never dropped). */
  const uploadParts = useCallback(async () => {
    if (partUploadingRef.current) return;
    partUploadingRef.current = true;
    try {
      while (partQueueRef.current.length) {
        const part = partQueueRef.current[0];
        const ok = await postPart(part);
        if (!ok) {
          part.attempts += 1;
          if (part.attempts >= 3 && !partFailureReportedRef.current) {
            partFailureReportedRef.current = true;
            reportSessionError(sessionId, {
              category: "client",
              severity: "warning",
              message: "Recording upload is failing; retrying in the background",
              context: { stage: "recording_part_upload", seq: part.seq, attempts: part.attempts },
            });
          }
          // Back off: 1s, 2s, 4s… (max 15s) before the next try.
          await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** Math.min(part.attempts - 1, 4))));
          if (part.attempts >= 8) break; // try again on the next tick
          continue;
        }
        partQueueRef.current.shift();
        partsUploadedRef.current += 1;
      }
    } finally {
      partUploadingRef.current = false;
    }
  }, [postPart, sessionId]);

  /** Wait until the queue is empty (or time runs out). */
  const drainParts = useCallback(
    async (timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!partQueueRef.current.length && !partUploadingRef.current) return true;
        if (!partUploadingRef.current) void uploadParts();
        await new Promise((r) => setTimeout(r, 200));
      }
      return !partQueueRef.current.length;
    },
    [uploadParts],
  );

  // Tab hidden / page closing: push what we have now (tab switches don't stop the recorder).
  useEffect(() => {
    const onHidden = () => {
      if (!recorderRef.current || stoppedRef.current) return;
      try { recorderRef.current.requestData(); } catch { /* inactive */ }
      // requestData is async; give it a tick, then upload.
      setTimeout(() => { cutPart(); void uploadParts(); }, 50);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") onHidden(); };
    const onPageHide = () => {
      if (!recorderRef.current || stoppedRef.current) return;
      cutPart();
      // Last chance: small parts can go out with keepalive while the page unloads.
      for (const part of partQueueRef.current) {
        if (part.blob.size <= KEEPALIVE_MAX_BYTES) void postPart(part, true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [cutPart, postPart, uploadParts]);

  /** Start recording audio and periodic screenshots. */
  const start = useCallback(
    async (micStream?: MediaStream) => {
      if (!enabled || isRecording) return;
      stoppedRef.current = false;
      ttsPlayTimeRef.current = 0;

      // Create mixing AudioContext and destination
      const ctx = new AudioContext();
      mixCtxRef.current = ctx;
      // Created outside a click handler, so it can start suspended (= silent recording).
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      ctx.onstatechange = () => {
        if (ctx.state === "suspended" && !stoppedRef.current) void ctx.resume().catch(() => {});
      };
      const dest = ctx.createMediaStreamDestination();
      mixDestRef.current = dest;

      // Attach mic if provided
      if (micStream) {
        attachMicStream(micStream);
      }

      // Start MediaRecorder — prefer MP4/AAC (iOS-compatible) with WebM fallback
      chunksRef.current = [];
      const preferredMime = ["audio/mp4", "audio/mp4;codecs=aac", "audio/webm;codecs=opus", "audio/webm"]
        .find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      audioMimeRef.current = preferredMime;
      log.info("Recording MIME:", preferredMime || "(default)");
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(dest.stream, {
          ...(preferredMime ? { mimeType: preferredMime } : {}),
          audioBitsPerSecond: RECORDING_BITRATE,
        });
      } catch {
        recorder = new MediaRecorder(dest.stream, preferredMime ? { mimeType: preferredMime } : undefined);
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          unsentChunksRef.current.push(e.data);
        }
      };
      recorder.onerror = (ev) => {
        const msg = (ev as unknown as { error?: { message?: string } }).error?.message ?? "unknown";
        reportSessionError(sessionId, {
          category: "client",
          severity: "error",
          message: `Audio recorder error: ${msg}`,
          context: { stage: "recorder_error" },
        });
      };
      runIdRef.current = Date.now();
      recordStartedAtRef.current = Date.now();
      partSeqRef.current = 0;
      unsentChunksRef.current = [];
      partQueueRef.current = [];
      partsUploadedRef.current = 0;
      partFailureReportedRef.current = false;
      recorder.start(5000); // collect chunks every 5s
      recorderRef.current = recorder;
      if (partTimerRef.current) clearInterval(partTimerRef.current);
      partTimerRef.current = setInterval(() => {
        cutPart();
        void uploadParts();
      }, PART_UPLOAD_INTERVAL_MS);

      if (captureVideo) {
        // Acquire camera + screen
        await acquireStreams();

        // Set up hidden video elements for screenshot capture
        if (!cameraVideoRef.current) {
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.style.display = "none";
          document.body.appendChild(v);
          cameraVideoRef.current = v;
        }
        if (!screenVideoRef.current) {
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.style.display = "none";
          document.body.appendChild(v);
          screenVideoRef.current = v;
        }

        // Bind streams to hidden video elements for canvas capture
        const bindStream = (video: HTMLVideoElement, stream: MediaStream | null) => {
          if (stream) {
            video.srcObject = stream;
            video.play().catch(() => {});
          }
        };
        // Use refs (set in acquireStreams via state update + useEffect sync)
        // Small delay to let state sync
        setTimeout(() => {
          bindStream(cameraVideoRef.current!, cameraStreamRef.current);
          bindStream(screenVideoRef.current!, screenStreamRef.current);
        }, 500);

        // Start periodic screenshot timer
        screenshotTimerRef.current = setInterval(takeScreenshots, screenshotIntervalMs);
      }

      setIsRecording(true);
      log.info("Started", captureVideo ? "(audio+video)" : "(audio only)");
    },
    [enabled, captureVideo, isRecording, acquireStreams, attachMicStream, takeScreenshots, screenshotIntervalMs, cutPart, uploadParts, sessionId],
  );

  /**
   * Stop recording. Uploads the audio blob and returns recording metadata.
   * Returns the list of screenshot entries.
   */
  const stop = useCallback(async (): Promise<{
    audioUrl?: string;
    audioDuration?: number;
    screenshots: ScreenshotEntry[];
  }> => {
    if (stoppedRef.current) {
      return { screenshots: screenshotsRef.current };
    }
    stoppedRef.current = true;

    // Stop screenshot timer
    if (screenshotTimerRef.current) {
      clearInterval(screenshotTimerRef.current);
      screenshotTimerRef.current = null;
    }

    if (partTimerRef.current) {
      clearInterval(partTimerRef.current);
      partTimerRef.current = null;
    }

    // Take one final set of screenshots
    takeScreenshots();

    // Stop MediaRecorder and collect audio
    let audioUrl: string | undefined;
    let audioDuration: number | undefined;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      const mime = audioMimeRef.current || "audio/webm";
      const isWebm = mime.includes("webm");
      const ext = isWebm ? "webm" : "m4a";
      const rawBlob = new Blob(chunksRef.current, { type: mime });

      // 1) Normal path: most audio is already on the server in parts — send the
      //    last part and ask the server to join + link them.
      cutPart();
      if (partSeqRef.current > 0) {
        const drained = await drainParts(8_000);
        if (drained) {
          try {
            const res = await fetch("/api/session/recording/finalize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId }),
            });
            const data = (await res.json().catch(() => ({}))) as { audioUrl?: string; audioDuration?: number };
            if (res.ok && data.audioUrl) {
              audioUrl = data.audioUrl;
              audioDuration = data.audioDuration;
              log.info("Audio saved from parts:", audioUrl);
            } else {
              log.warn("Recording finalize did not return a file", res.status);
            }
          } catch (err) {
            log.warn("Recording finalize failed:", err);
          }
        }
      }

      // 2) Fallback: upload the whole file (the server links it to the session itself).
      if (!audioUrl && rawBlob.size > 0) {
        audioDuration = await resolveBlobDuration(rawBlob);

        // Patch WebM container with correct duration so players can display it
        const audioBlob = (isWebm && audioDuration)
          ? await fixWebmDuration(rawBlob, audioDuration * 1000)
          : rawBlob;

        try {
          const fname = `recording-${Date.now()}.${ext}`;
          const form = new FormData();
          form.append("file", audioBlob, fname);
          form.append("sessionId", sessionId);
          form.append("type", "recording");
          form.append("filename", fname);
          if (audioDuration) form.append("audioDuration", String(audioDuration));

          const res = await fetch("/api/session/upload", {
            method: "POST",
            body: form,
          });
          if (res.ok) {
            const data = await res.json();
            // Prefer durable object key over short-lived signed URL
            audioUrl = data.path || data.url;
            log.info("Audio uploaded:", audioUrl);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          log.error("Audio upload failed:", err);
          reportSessionError(sessionId, {
            category: "client",
            severity: "error",
            message: `Recording upload failed: ${err instanceof Error ? err.message : String(err)}`,
            context: { stage: "recording_upload", bytes: rawBlob.size, partsUploaded: partsUploadedRef.current },
          });
        }
      }
      if (!audioUrl) {
        reportSessionError(sessionId, {
          category: "client",
          severity: "warning",
          message: "No recording was saved at the end of the interview",
          context: { stage: "recording_missing", bytes: rawBlob.size, partsUploaded: partsUploadedRef.current, partsQueued: partQueueRef.current.length },
        });
      }
    }

    // Disconnect mic source
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    micSourceRef.current = null;

    // Close mix context
    try { mixCtxRef.current?.close(); } catch { /* noop */ }
    mixCtxRef.current = null;
    mixDestRef.current = null;
    recorderRef.current = null;

    // Stop camera/screen tracks
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);
    setScreenStream(null);

    // Clean up hidden video elements
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current.remove();
      cameraVideoRef.current = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      screenVideoRef.current.remove();
      screenVideoRef.current = null;
    }

    setIsRecording(false);
    log.info("Stopped");

    return {
      audioUrl,
      audioDuration,
      screenshots: screenshotsRef.current,
    };
  }, [sessionId, takeScreenshots, cutPart, drainParts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (screenshotTimerRef.current) clearInterval(screenshotTimerRef.current);
      if (partTimerRef.current) clearInterval(partTimerRef.current);
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
      try { mixCtxRef.current?.close(); } catch { /* noop */ }
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (cameraVideoRef.current) { cameraVideoRef.current.remove(); cameraVideoRef.current = null; }
      if (screenVideoRef.current) { screenVideoRef.current.remove(); screenVideoRef.current = null; }
    };
  }, []);

  return {
    start,
    stop,
    addTtsChunk,
    cancelTts,
    attachMicStream,
    cameraStream,
    screenStream,
    isRecording,
    screenshots: screenshotsRef,
  };
}
