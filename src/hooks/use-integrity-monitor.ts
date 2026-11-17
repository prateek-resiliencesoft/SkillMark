"use client";

import { detectionsSuppressed, suppressDetections } from "@/lib/anti-cheating-state";
import { AvSyncMonitor, SpeechGate } from "@/lib/integrity/av-sync";
import { isAiSpeaking, registerMediaTrack, subscribeFaceFrames, subscribeMediaTracks } from "@/lib/integrity/bus";
import { classifyDeviceLabel } from "@/lib/integrity/devices";
import {
  LIVENESS_PROMPT,
  LIVENESS_TIMEOUT_MS,
  LivenessChallenge,
  pickLivenessSchedule,
  type LivenessKind,
} from "@/lib/integrity/liveness";
import { ReadingPatternDetector } from "@/lib/integrity/reading-pattern";
import { classifyInjectedMarker, type IntegritySignal } from "@/lib/integrity/signals";
import { useEffect, useRef, useState } from "react";

export type IntegrityWarnKind = "offscreen_voice" | "device_switch";

interface Options {
  enabled: boolean;
  livenessEnabled: boolean;
  /** Warn tier: shown to the candidate and counted as a strike. */
  onWarn: (kind: IntegrityWarnKind, detail: string) => void;
  /** Virtual camera / mic in use: ask the candidate to switch (no strike). */
  onVirtualDevice: (label: string, kind: "audio" | "video") => void;
  /** Silent tier: reviewer-only. */
  onSignal: (signal: IntegritySignal) => void;
}

const TICK_MS = 200;
/** use-voice keeps the AI-speaking flag up this long after playback ends. */
const AI_HOLD_MS = 500;
const EXTENSION_URL = /^(chrome|moz|safari-web)-extension:\/\//i;

/**
 * Integrity checks on top of the existing anti-cheating guards. Consumes the
 * head tracker's face frames and the interview's own media tracks via the
 * integrity bus; opens only a mic analyser of its own.
 */
export function useIntegrityMonitor({ enabled, livenessEnabled, onWarn, onVirtualDevice, onSignal }: Options) {
  const cb = useRef({ onWarn, onVirtualDevice, onSignal });
  cb.current = { onWarn, onVirtualDevice, onSignal };
  const [livenessPrompt, setLivenessPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const signal = (s: Omit<IntegritySignal, "timestamp">) => cb.current.onSignal({ ...s, timestamp: Date.now() });
    const cleanups: (() => void)[] = [];
    let cancelled = false;

    // ── Devices actually in use ───────────────────────────────────
    const firstDevice: Partial<Record<"audio" | "video", string>> = {};
    const seenLabels = new Set<string>();
    const lastSettings = new Map<MediaStreamTrack, string>();
    cleanups.push(
      subscribeMediaTracks((track) => {
        const kind = track.kind === "video" ? "video" : "audio";
        const label = track.label || "";
        const cls = classifyDeviceLabel(kind, label);
        if (label && !seenLabels.has(label)) {
          seenLabels.add(label);
          if (cls === "virtual") {
            signal({ type: kind === "video" ? "virtual_camera" : "virtual_microphone", detail: label.slice(0, 200) });
            cb.current.onVirtualDevice(label, kind);
          } else if (cls === "processing") {
            signal({ type: "processing_device", detail: label.slice(0, 200) });
          }
        }
        const deviceId = track.getSettings().deviceId;
        if (deviceId) {
          if (!firstDevice[kind]) firstDevice[kind] = deviceId;
          else if (firstDevice[kind] !== deviceId) {
            firstDevice[kind] = deviceId;
            cb.current.onWarn("device_switch", `${kind === "video" ? "Camera" : "Microphone"} switched to "${label || "unknown device"}"`);
          }
        }
        // `ended` only fires when the source goes away (unplugged, revoked,
        // virtual source stopped), never for our own track.stop().
        track.addEventListener(
          "ended",
          () => signal({ type: "device_changed", detail: `${kind === "video" ? "Camera" : "Microphone"} stream ended: ${label || "unknown"}` }),
          { once: true },
        );
        lastSettings.set(track, settingsKey(track));
      }),
    );
    const settingsTimer = setInterval(() => {
      lastSettings.forEach((prev, track) => {
        if (track.readyState !== "live") { lastSettings.delete(track); return; }
        const now = settingsKey(track);
        if (now !== prev) {
          lastSettings.set(track, now);
          signal({ type: "device_changed", detail: `${track.kind} settings changed: ${prev} → ${now}`.slice(0, 200) });
        }
      });
    }, 10_000);
    cleanups.push(() => clearInterval(settingsTimer));
    const onDeviceChange = () => signal({ type: "device_changed", detail: "Media devices were plugged in or removed" });
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    cleanups.push(() => navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange));

    // ── Extensions injecting into this page ───────────────────────
    const seenMarkers = new Set<string>();
    const reportMarker = (marker: string) => {
      const m = marker.slice(0, 200);
      if (seenMarkers.has(m)) return;
      seenMarkers.add(m);
      signal({ type: "extension_injection", value: classifyInjectedMarker(m), detail: m });
    };
    const inspect = (el: Element) => {
      for (const attr of ["src", "href"]) {
        const v = el.getAttribute(attr);
        if (v && EXTENSION_URL.test(v)) reportMarker(v);
      }
      const parent = el.parentElement;
      const topLevel = !parent || parent === document.body || parent === document.documentElement;
      if (topLevel && el.tagName.includes("-")) reportMarker(el.tagName.toLowerCase());
    };
    document.querySelectorAll("body > *, html > *, [src^='chrome-extension:'], [src^='moz-extension:'], [href^='chrome-extension:']").forEach(inspect);
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => { if (n instanceof Element) inspect(n); });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    cleanups.push(() => mo.disconnect());
    const scanResources = () =>
      performance.getEntriesByType("resource").forEach((e) => { if (EXTENSION_URL.test(e.name)) reportMarker(e.name); });
    scanResources();
    const resourceTimer = setInterval(scanResources, 15_000);
    cleanups.push(() => clearInterval(resourceTimer));

    // ── Mic analyser (lip-sync + answer timing) ───────────────────
    let analyser: AnalyserNode | null = null;
    let micStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    const buf = new Float32Array(2048);
    const readRms = () => {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    };
    (async () => {
      try {
        suppressDetections(15_000);
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        if (cancelled) { micStream.getTracks().forEach((t) => t.stop()); return; }
        micStream.getAudioTracks().forEach(registerMediaTrack);
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = buf.length;
        audioCtx.createMediaStreamSource(micStream).connect(analyser);
      } catch (err) {
        console.warn("[integrity] mic analyser unavailable", err);
        signal({ type: "detector_unavailable", detail: "Microphone analyser could not start" });
      }
    })();
    cleanups.push(() => {
      micStream?.getTracks().forEach((t) => t.stop());
      void audioCtx?.close().catch(() => {});
    });

    // Answer start delay: AI stops speaking → candidate starts.
    const gate = new SpeechGate();
    let prevAi = false;
    let aiEndedAt: number | null = null;
    let speechTicks = 0;
    const tick = setInterval(() => {
      if (!analyser) return;
      const now = Date.now();
      const ai = isAiSpeaking();
      const speech = gate.update(readRms());
      if (prevAi && !ai) { aiEndedAt = now - AI_HOLD_MS; speechTicks = 0; }
      if (ai) aiEndedAt = null;
      prevAi = ai;
      if (aiEndedAt === null) return;
      if (now - aiEndedAt > 30_000) { aiEndedAt = null; return; }
      speechTicks = speech ? speechTicks + 1 : 0;
      if (speechTicks >= 2) {
        const latency = now - (speechTicks - 1) * TICK_MS - aiEndedAt;
        signal({ type: "response_latency", value: Math.max(0, Math.round(latency)) });
        aiEndedAt = null;
      }
    }, TICK_MS);
    cleanups.push(() => clearInterval(tick));

    // ── Face frames: lip-sync, reading pattern, liveness ──────────
    const av = new AvSyncMonitor();
    const reading = new ReadingPatternDetector();
    let challenge: LivenessChallenge | null = null;
    let lastFrameAt = 0;
    cleanups.push(
      subscribeFaceFrames((f) => {
        lastFrameAt = f.t;
        if (challenge) {
          const r = challenge.update({ t: f.t, faces: f.faces, yaw: f.yaw, smile: f.smile });
          if (r) {
            signal({ type: "liveness", value: r === "pass" ? 1 : 0, detail: `${challenge.kind.replace("_", " ")}${r === "fail" ? " (no matching response)" : ""}` });
            challenge = null;
            setLivenessPrompt(null);
          }
          return;
        }
        if (!analyser || detectionsSuppressed()) return;
        const ai = isAiSpeaking();
        const res = av.update({ t: f.t, rms: readRms(), jawOpen: f.jawOpen, faces: f.faces, aiSpeaking: ai });
        if (res.offscreenVoiceMs) {
          cb.current.onWarn("offscreen_voice", `Voice detected for ${(res.offscreenVoiceMs / 1000).toFixed(0)}s while the visible face's mouth stayed closed`);
        }
        if (res.segment) {
          signal({
            type: "av_correlation",
            value: Number(res.segment.correlation.toFixed(3)),
            detail: `${Math.round((res.segment.samples * TICK_MS) / 1000)}s answer, ${Math.round(res.segment.speechRatio * 100)}% speech`,
          });
        }
        if (f.gazeX !== null) {
          const sweeps = reading.update({ t: f.t, x: f.gazeX }, av.speaking && !ai);
          if (sweeps) signal({ type: "reading_pattern", value: sweeps });
        }
      }),
    );

    if (livenessEnabled) {
      const startedAt = Date.now();
      const timers: ReturnType<typeof setTimeout>[] = [];
      const run = (kind: LivenessKind) => {
        if (cancelled) return;
        if (document.hidden || detectionsSuppressed() || challenge) {
          timers.push(setTimeout(() => run(kind), 30_000));
          return;
        }
        if (Date.now() - lastFrameAt > 5000) {
          signal({ type: "detector_unavailable", detail: "Liveness check skipped: face tracking not running" });
          return;
        }
        // Head turns / covering the face must not count as head-movement strikes.
        suppressDetections(LIVENESS_TIMEOUT_MS + 2000);
        challenge = new LivenessChallenge(kind, Date.now());
        setLivenessPrompt(LIVENESS_PROMPT[kind]);
      };
      for (const s of pickLivenessSchedule()) timers.push(setTimeout(() => run(s.kind), Math.max(0, startedAt + s.atMs - Date.now())));
      cleanups.push(() => timers.forEach(clearTimeout));
    }

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
      setLivenessPrompt(null);
    };
  }, [enabled, livenessEnabled]);

  return { livenessPrompt };
}

function settingsKey(track: MediaStreamTrack): string {
  const s = track.getSettings();
  return track.kind === "video"
    ? `${s.width ?? "?"}x${s.height ?? "?"}@${s.frameRate ? Math.round(s.frameRate) : "?"}`
    : `${s.sampleRate ?? "?"}Hz/${s.channelCount ?? "?"}ch`;
}
