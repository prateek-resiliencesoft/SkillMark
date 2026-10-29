"use client";

import {
  DEFAULT_HEAD_THRESHOLDS,
  HeadMovementMonitor,
  classifyFrame,
  matrixToYawPitch,
  type HeadFrameState,
} from "@/lib/head-movement";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

const MP_VERSION = "1.2.0";
const LOCAL_WASM = "/mediapipe/wasm";
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const LOCAL_MODEL = "/mediapipe/face_landmarker.task";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FRAME_INTERVAL_MS = 200;

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

interface Options {
  enabled: boolean;
  onViolation: (kind: Exclude<HeadFrameState, "ok">) => void;
}

/** Webcam head-pose tracking with MediaPipe Face Landmarker (runs fully in the browser). */
export function useHeadMovementDetection({ enabled, onViolation }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let landmarker: FaceLandmarker | null = null;
    const monitor = new HeadMovementMonitor(DEFAULT_HEAD_THRESHOLDS);

    (async () => {
      setStatus("loading");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) return;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        videoRef.current = video;

        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const wasmBase = (await exists(`${LOCAL_WASM}/vision_wasm_internal.js`)) ? LOCAL_WASM : CDN_WASM;
        const modelPath = (await exists(LOCAL_MODEL)) ? LOCAL_MODEL : CDN_MODEL;
        const fileset = await FilesetResolver.forVisionTasks(wasmBase);
        const create = (delegate: "GPU" | "CPU") =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelPath, delegate },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFacialTransformationMatrixes: true,
          });
        const lm = await create("GPU").catch(() => create("CPU"));
        if (cancelled) {
          lm.close();
          return;
        }
        landmarker = lm;
        setStatus("active");

        timer = setInterval(() => {
          if (!landmarker || video.readyState < 2) return;
          if (document.hidden) return; // tab departures are handled by the main anti-cheating guard
          const now = performance.now();
          let res: FaceLandmarkerResult;
          try {
            res = landmarker.detectForVideo(video, now);
          } catch {
            return;
          }
          const matrices = res.facialTransformationMatrixes ?? [];
          const faceCount = res.faceLandmarks?.length ?? matrices.length;
          const faces =
            matrices.length > 0
              ? matrices.map((m) => matrixToYawPitch(m.data))
              : Array.from({ length: faceCount }, () => ({ yaw: 0, pitch: 0 }));
          const kind = monitor.update(classifyFrame(faces), Date.now());
          if (kind) onViolationRef.current(kind);
        }, FRAME_INTERVAL_MS);
      } catch (err) {
        console.warn("[head-movement] detector unavailable", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      try {
        landmarker?.close();
      } catch {
        /* noop */
      }
      stream?.getTracks().forEach((t) => t.stop());
      videoRef.current = null;
    };
  }, [enabled]);

  /** JPEG snapshot of the current webcam frame. */
  const captureSnapshot = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
  }, []);

  return { status, captureSnapshot };
}
