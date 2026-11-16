/**
 * Browser Silero VAD loader (@ricky0123/vad-web + onnxruntime-web).
 * Assets are self-hosted under /vad/ (see scripts/vad-assets.sh).
 */
"use client";

import { ENDPOINTING_CONFIG } from "./endpointing-config";

/** Avoid a static onnxruntime import so Next SSR/webpack does not choke. */
export type InterviewVad = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
  listening: boolean;
};

export interface InterviewVadHandlers {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Raw speech probability for the latest frame (0–1). */
  onSpeechProb?: (probability: number) => void;
  onMisfire?: () => void;
}

export interface CreateInterviewVadOptions extends InterviewVadHandlers {
  /** Shared mic stream from the interview capture pipeline. */
  getStream: () => Promise<MediaStream>;
  /** Optional existing AudioContext (MicVAD creates one when omitted). */
  audioContext?: AudioContext;
}

/** Quick HEAD/GET check that self-hosted onnx + worklet are reachable. */
export async function preloadVadAssets(
  timeoutMs = ENDPOINTING_CONFIG.loadTimeoutMs,
): Promise<boolean> {
  const base = ENDPOINTING_CONFIG.baseAssetPath.replace(/\/?$/, "/");
  const urls = [
    `${base}vad.worklet.bundle.min.js`,
    `${base}silero_vad_${ENDPOINTING_CONFIG.model}.onnx`,
    `${ENDPOINTING_CONFIG.onnxWASMBasePath.replace(/\/?$/, "/")}ort-wasm-simd-threaded.wasm`,
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await Promise.all(
      urls.map(async (url) => {
        const res = await fetch(url, { method: "GET", signal: controller.signal });
        if (!res.ok) throw new Error(`VAD asset ${url} → ${res.status}`);
        // Drain so the browser can cache; ignore body contents.
        await res.arrayBuffer();
      }),
    );
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Absolute URL for a VAD asset folder (worklets resolve relative URLs oddly in some browsers). */
export function absoluteAssetBase(path: string, origin?: string): string {
  const base = path.replace(/\/?$/, "/");
  const o = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (/^https?:\/\//i.test(base) || !o) return base;
  return new URL(base, o).href;
}

export type VadProcessorType = "AudioWorklet" | "ScriptProcessor";

/** Order to try audio processors in: worklet first (when supported), then the old ScriptProcessor. */
export function vadProcessorOrder(workletSupported: boolean): VadProcessorType[] {
  return workletSupported ? ["AudioWorklet", "ScriptProcessor"] : ["ScriptProcessor"];
}

/** Last reason Silero could not start (for error reports). */
export let lastVadStartError: string | null = null;
/** Which audio processor the running Silero instance uses. */
export let activeVadProcessor: VadProcessorType | null = null;

async function buildMicVad(
  options: CreateInterviewVadOptions,
  processorType: VadProcessorType,
): Promise<InterviewVad> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const vad = await Promise.race([
    MicVAD.new({
      startOnLoad: false,
      model: ENDPOINTING_CONFIG.model,
      baseAssetPath: absoluteAssetBase(ENDPOINTING_CONFIG.baseAssetPath),
      onnxWASMBasePath: absoluteAssetBase(ENDPOINTING_CONFIG.onnxWASMBasePath),
      positiveSpeechThreshold: ENDPOINTING_CONFIG.positiveSpeechThreshold,
      negativeSpeechThreshold: ENDPOINTING_CONFIG.negativeSpeechThreshold,
      redemptionMs: ENDPOINTING_CONFIG.redemptionMs,
      preSpeechPadMs: ENDPOINTING_CONFIG.preSpeechPadMs,
      minSpeechMs: ENDPOINTING_CONFIG.minSpeechMs,
      processorType,
      audioContext: options.audioContext,
      getStream: options.getStream,
      // We own the MediaStream — never stop tracks when MicVAD pauses/destroys.
      pauseStream: async () => {},
      resumeStream: async (stream) => stream,
      onSpeechStart: () => options.onSpeechStart(),
      onSpeechEnd: () => options.onSpeechEnd(),
      onVADMisfire: () => options.onMisfire?.(),
      onSpeechRealStart: () => {},
      onFrameProcessed: (probs) => {
        options.onSpeechProb?.(probs.isSpeech);
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Silero VAD load timed out")),
        ENDPOINTING_CONFIG.loadTimeoutMs,
      ),
    ),
  ]);
  return vad;
}

/**
 * Create AND start Silero on our mic stream. Never throws.
 * Tries the AudioWorklet processor first (twice — a flaky network can make
 * `audioWorklet.addModule` fail with "Unable to load a worklet's module"),
 * then falls back to the ScriptProcessor processor, which needs no worklet
 * file at all. Returns null only when every option failed; the caller then
 * uses the AI's own speech detection, and mic capture keeps working.
 */
export async function startInterviewVad(
  options: CreateInterviewVadOptions,
): Promise<InterviewVad | null> {
  lastVadStartError = null;
  activeVadProcessor = null;
  const workletSupported =
    typeof window !== "undefined" &&
    typeof AudioWorkletNode === "function" &&
    typeof AudioContext !== "undefined" &&
    "audioWorklet" in AudioContext.prototype;
  const plan: VadProcessorType[] = [];
  for (const t of vadProcessorOrder(workletSupported)) {
    plan.push(t);
    if (t === "AudioWorklet") plan.push(t); // one retry for a transient load failure
  }
  for (const processorType of plan) {
    let vad: InterviewVad | null = null;
    try {
      vad = await buildMicVad(options, processorType);
      await vad.start();
      activeVadProcessor = processorType;
      return vad;
    } catch (err) {
      lastVadStartError = `${processorType}: ${err instanceof Error ? err.message : String(err)}`;
      if (vad) await vad.destroy().catch(() => {});
    }
  }
  return null;
}

/**
 * Create a MicVAD instance (not started). Kept for the onboarding mic test.
 * Returns null when the model / wasm fails to load.
 */
export async function createInterviewVad(
  options: CreateInterviewVadOptions,
): Promise<InterviewVad | null> {
  try {
    return await buildMicVad(options, "AudioWorklet");
  } catch {
    try {
      return await buildMicVad(options, "ScriptProcessor");
    } catch {
      return null;
    }
  }
}
