"use client";

import { useEffect, useRef } from "react";

import { useMicrophoneLevel, type MeterFrame } from "@/hooks/use-microphone-level";
import type { MicStatus, MicTone, MicWarning } from "@/lib/audio/level-guidance";
import { dbToFraction, formatDb } from "@/lib/audio/level-math";
import { LEVEL_CONFIG } from "@/lib/audio/level-thresholds";
import { cn } from "@/lib/utils";

interface Props {
  /** The existing interview mic stream (never opened here). null = mic off. */
  stream: MediaStream | null;
  /** App-level mute. */
  muted?: boolean;
  /** getUserMedia was refused. */
  permissionDenied?: boolean;
  /** Candidate should be answering now (enables the "too quiet" nudge). */
  expectSpeaking?: boolean;
  compact?: boolean;
  className?: string;
}

const GAP = "hsl(var(--card))";
const GREEN = "#22c55e";
const YELLOW = "#eab308";
const RED = "#ef4444";

const f = (db: number) => dbToFraction(db) * 100;
// Left -> right: green up to -12 dBFS, yellow to -6, red above (segmented).
const BAR_GRADIENT = `linear-gradient(to right, ${GREEN} 0 ${f(LEVEL_CONFIG.goodBelowDb)}%, ${YELLOW} ${f(LEVEL_CONFIG.goodBelowDb)}% ${f(LEVEL_CONFIG.loudBelowDb)}%, ${RED} ${f(LEVEL_CONFIG.loudBelowDb)}% 100%)`;
const TICKS = [-60, -30, -12, -6, 0];
const DOT: Record<MicTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
  neutral: "bg-zinc-500",
};
const LABEL: Record<MicStatus, string> = {
  good: "Good",
  quiet: "Quiet",
  loud: "Loud",
  muted: "Muted",
  disconnected: "Disconnected",
  "no-permission": "No permission",
  idle: "Mic",
};
const PILL: Record<MicWarning, string> = {
  "too-quiet": "bg-amber-500 text-black",
  "too-loud": "bg-red-600 text-white",
  muted: "bg-red-600 text-white",
  disconnected: "bg-red-600 text-white",
  "no-permission": "bg-red-600 text-white",
};

function holdColor(db: number): string {
  return db >= LEVEL_CONFIG.loudBelowDb ? RED : db >= LEVEL_CONFIG.goodBelowDb ? YELLOW : GREEN;
}

/** Horizontal segmented bar. Lit part and peak marker are moved by direct style writes (no React per frame). */
function Bar({ segments, litRef, holdRef }: {
  segments: number;
  litRef: React.RefObject<HTMLDivElement>;
  holdRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="relative h-2 overflow-hidden rounded-sm bg-muted">
      <div className="absolute inset-0" style={{ background: BAR_GRADIENT, opacity: 0.18 }} />
      <div ref={litRef} className="absolute inset-0" style={{ background: BAR_GRADIENT, clipPath: "inset(0 100% 0 0)" }} />
      {/* segment gaps */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to right, transparent calc(100% - 1px), ${GAP} calc(100% - 1px))`,
          backgroundSize: `${100 / segments}% 100%`,
        }}
      />
      <div ref={holdRef} className="absolute inset-y-0 w-[2px]" style={{ left: 0, background: GREEN, opacity: 0 }} />
    </div>
  );
}

/**
 * Horizontal stereo VU / peak meter for the candidate's microphone (dBFS, peak hold).
 * Measures the shared interview MediaStream passively; changes nothing about recording or transcription.
 */
export function MicrophoneLevelMeter({ stream, muted, permissionDenied, expectSpeaking, compact, className }: Props) {
  const { guidance, mono, subscribe } = useMicrophoneLevel({ stream, muted, permissionDenied, expectSpeaking });
  const litL = useRef<HTMLDivElement>(null);
  const litR = useRef<HTMLDivElement>(null);
  const holdL = useRef<HTMLDivElement>(null);
  const holdR = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let lastText = 0;
    const paint = (lit: HTMLDivElement | null, hold: HTMLDivElement | null, db: number, holdDb: number) => {
      if (lit) lit.style.clipPath = `inset(0 ${100 - f(db)}% 0 0)`;
      if (hold) {
        hold.style.left = `calc(${f(holdDb)}% - 2px)`;
        hold.style.opacity = holdDb > LEVEL_CONFIG.scaleMinDb ? "1" : "0";
        hold.style.background = holdColor(holdDb);
      }
    };
    return subscribe((fr: MeterFrame) => {
      paint(litL.current, holdL.current, fr.l, fr.holdL);
      paint(litR.current, holdR.current, fr.r, fr.holdR);
      const now = performance.now();
      if (readout.current && (now - lastText > 100 || fr.l <= LEVEL_CONFIG.floorDb)) {
        lastText = now;
        readout.current.textContent = `${formatDb(Math.max(fr.l, fr.r))} dB`;
      }
    });
  }, [subscribe]);

  const segments = compact ? 20 : 32;
  const label = guidance.noSignal && guidance.status === "quiet" && !guidance.warning ? "No signal" : LABEL[guidance.status];

  return (
    <div
      className={cn("relative flex items-center gap-2.5", className)}
      role="group"
      aria-label="Microphone level"
      title={guidance.message ?? undefined}
    >
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[guidance.tone])} aria-hidden />
        <span className="truncate">{label}</span>
      </span>

      <div className={cn("flex flex-col gap-0.5", compact ? "w-36" : "w-44 xl:w-56")}>
        <Bar segments={segments} litRef={litL} holdRef={holdL} />
        <Bar segments={segments} litRef={litR} holdRef={holdR} />
        <div className="relative h-2.5 select-none" aria-hidden>
          {/* target ("good") zone */}
          <span
            className="absolute top-0 h-px bg-emerald-500/70"
            style={{ left: `${f(LEVEL_CONFIG.quietBelowDb)}%`, width: `${f(LEVEL_CONFIG.goodBelowDb) - f(LEVEL_CONFIG.quietBelowDb)}%` }}
          />
          {TICKS.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute top-0.5 text-[8px] leading-none tabular-nums text-muted-foreground",
                t === 0 ? "-translate-x-full" : t === -60 ? "" : "-translate-x-1/2",
              )}
              style={{ left: `${f(t)}%` }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <span className="flex w-14 shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
        <span ref={readout}>{formatDb(LEVEL_CONFIG.floorDb)} dB</span>
        {mono && stream && (
          <span className="rounded border border-border px-0.5 text-[7px] font-semibold uppercase" title="Single-channel microphone: both bars show the same level">
            Mono
          </span>
        )}
      </span>

      {guidance.warning && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-max max-w-[min(18rem,calc(100vw-1rem))] rounded-md px-2.5 py-1.5 text-xs font-medium leading-snug shadow-lg",
            PILL[guidance.warning],
          )}
        >
          {guidance.message}
        </div>
      )}
    </div>
  );
}
