"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { IDLE_GUIDANCE, LevelGuidance, type GuidanceState, type MicState } from "@/lib/audio/level-guidance";
import { Ballistics, PeakHold, measureBuffer, rmsToDbfs } from "@/lib/audio/level-math";
import { LEVEL_CONFIG } from "@/lib/audio/level-thresholds";

/** One drawn frame. Everything is a finite dBFS value. */
export interface MeterFrame {
  /** Display level (after attack/release ballistics). */
  l: number;
  r: number;
  /** Peak-hold markers. */
  holdL: number;
  holdR: number;
  /** Mono source: both bars mirror the one channel. */
  mono: boolean;
}

const SILENT_FRAME: MeterFrame = {
  l: LEVEL_CONFIG.floorDb,
  r: LEVEL_CONFIG.floorDb,
  holdL: LEVEL_CONFIG.floorDb,
  holdR: LEVEL_CONFIG.floorDb,
  mono: true,
};

interface Options {
  /** The EXISTING mic MediaStream (never opened here). null while the mic is off. */
  stream: MediaStream | null;
  /** App-level mute (the interview's mic button). */
  muted?: boolean;
  /** getUserMedia was refused. */
  permissionDenied?: boolean;
  /** Candidate should be answering right now (AI not talking / thinking). */
  expectSpeaking?: boolean;
}

function micStateOf(stream: MediaStream): MicState {
  const tracks = stream.getAudioTracks().filter((t) => t.readyState === "live");
  if (!tracks.length || !stream.active) return "disconnected";
  return tracks.some((t) => t.enabled && !t.muted) ? "live" : "muted";
}

/**
 * Passive level tap on a shared mic stream (Web Audio AnalyserNode, never connected
 * to the destination). Does not touch the stream's tracks, gain or constraints; the
 * only thing it owns (its own AudioContext + nodes) is closed on cleanup.
 *
 * Per-frame levels go to `subscribe` listeners (no React renders). React state only
 * changes when the coarse guidance (status/warning) changes.
 */
export function useMicrophoneLevel({ stream, muted = false, permissionDenied = false, expectSpeaking = false }: Options) {
  const [guidance, setGuidance] = useState<GuidanceState>(IDLE_GUIDANCE);
  const [mono, setMono] = useState(true);

  const listenersRef = useRef(new Set<(f: MeterFrame) => void>());
  const flagsRef = useRef({ muted, permissionDenied, expectSpeaking });
  flagsRef.current = { muted, permissionDenied, expectSpeaking };

  const subscribe = useCallback((fn: (f: MeterFrame) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const emit = (f: MeterFrame) => listenersRef.current.forEach((fn) => fn(f));

  useEffect(() => {
    const guide = new LevelGuidance();
    let lastKey = "";
    const publish = (g: GuidanceState) => {
      const key = `${g.status}|${g.tone}|${g.warning}|${g.noSignal}`;
      if (key === lastKey) return;
      lastKey = key;
      setGuidance(g);
    };

    // No stream (mic off / not started / refused): the effect below sets the static status.
    if (!stream || typeof window === "undefined") {
      setMono(true);
      emit(SILENT_FRAME);
      return;
    }

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audioTrack = stream.getAudioTracks()[0];
    if (!Ctor || !audioTrack) {
      publish(guide.update({ now: 0, micState: audioTrack ? "idle" : "disconnected", db: LEVEL_CONFIG.floorDb, peakDb: LEVEL_CONFIG.floorDb, expectSpeaking: false }));
      return;
    }

    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let splitter: ChannelSplitterNode | null = null;
    const analysers: AnalyserNode[] = [];
    try {
      ctx = new Ctor(); // own context, default rate: level only, nothing is sent from here
      source = ctx.createMediaStreamSource(stream);
    } catch {
      void ctx?.close().catch(() => {});
      publish(guide.update({ now: 0, micState: "idle", db: LEVEL_CONFIG.floorDb, peakDb: LEVEL_CONFIG.floorDb, expectSpeaking: false }));
      return;
    }

    // Stereo only if the track really is stereo; otherwise mirror one analyser.
    const stereo = (audioTrack.getSettings().channelCount ?? 1) >= 2;
    setMono(!stereo);
    if (stereo) {
      splitter = ctx.createChannelSplitter(2);
      source.connect(splitter);
      for (const ch of [0, 1]) {
        const a = ctx.createAnalyser();
        a.fftSize = 2048;
        splitter.connect(a, ch);
        analysers.push(a);
      }
    } else {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      source.connect(a);
      analysers.push(a);
    }
    const bufs = analysers.map((a) => new Float32Array(a.fftSize));
    const ball = analysers.map(() => new Ballistics());
    const hold = analysers.map(() => new PeakHold());

    let micState = micStateOf(stream);
    const refreshState = () => {
      micState = micStateOf(stream);
    };
    const resume = () => {
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    const onVisibility = () => {
      if (!document.hidden) resume();
    };
    const tracks = stream.getAudioTracks();
    const trackEvents = ["mute", "unmute", "ended"] as const;
    for (const t of tracks) for (const e of trackEvents) t.addEventListener(e, refreshState);
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshState);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    ctx.addEventListener("statechange", resume);
    resume();

    let raf = 0;
    let lastNow: number | null = null;
    let lastPoll = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // track.enabled has no event: poll cheaply (also covers missed ended/mute events).
      if (now - lastPoll > 250) {
        lastPoll = now;
        refreshState();
      }
      const dt = lastNow == null ? 16 : now - lastNow;
      lastNow = now;

      const db: number[] = [];
      let peak = 0;
      analysers.forEach((a, i) => {
        a.getFloatTimeDomainData(bufs[i]);
        const m = measureBuffer(bufs[i]);
        if (m.peak > peak) peak = m.peak;
        db.push(rmsToDbfs(m.rms));
      });
      const live = micState === "live";
      const shown = db.map((d, i) => ball[i].update(live ? d : LEVEL_CONFIG.floorDb, dt));
      const held = shown.map((d, i) => hold[i].update(d, now));
      emit({
        l: shown[0],
        r: shown[1] ?? shown[0],
        holdL: held[0],
        holdR: held[1] ?? held[0],
        mono: analysers.length === 1,
      });

      const f = flagsRef.current;
      const state: MicState = f.permissionDenied ? "no-permission" : f.muted ? "muted" : micState;
      publish(
        guide.update({
          now,
          micState: state,
          db: Math.max(...db),
          peakDb: rmsToDbfs(peak),
          expectSpeaking: f.expectSpeaking,
        }),
      );
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      for (const t of tracks) for (const e of trackEvents) t.removeEventListener(e, refreshState);
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshState);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      ctx?.removeEventListener("statechange", resume);
      source?.disconnect();
      splitter?.disconnect();
      analysers.forEach((a) => a.disconnect());
      // Our own context only: the shared tracks are never stopped here.
      void ctx?.close().catch(() => {});
    };
    // Flags are read through flagsRef so they never restart the audio graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Static (no stream) status must follow the flags; the live loop reads them itself.
  useEffect(() => {
    if (stream) return;
    setGuidance((prev) => {
      const g = new LevelGuidance().update({
        now: 0,
        micState: permissionDenied ? "no-permission" : muted ? "muted" : "idle",
        db: LEVEL_CONFIG.floorDb,
        peakDb: LEVEL_CONFIG.floorDb,
        expectSpeaking: false,
      });
      return g.status === prev.status ? prev : g;
    });
  }, [stream, muted, permissionDenied]);

  return { guidance, mono, subscribe };
}
