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

/**
 * Create a MicVAD instance that reuses our mic stream and never stops its tracks.
 * Returns null when the model / wasm fails to load (caller falls back to automatic VAD).
 */
export async function createInterviewVad(
  options: CreateInterviewVadOptions,
): Promise<InterviewVad | null> {
  const started = Date.now();
  try {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const vad = await Promise.race([
      MicVAD.new({
        startOnLoad: false,
        model: ENDPOINTING_CONFIG.model,
        baseAssetPath: ENDPOINTING_CONFIG.baseAssetPath,
        onnxWASMBasePath: ENDPOINTING_CONFIG.onnxWASMBasePath,
        positiveSpeechThreshold: ENDPOINTING_CONFIG.positiveSpeechThreshold,
        negativeSpeechThreshold: ENDPOINTING_CONFIG.negativeSpeechThreshold,
        redemptionMs: ENDPOINTING_CONFIG.redemptionMs,
        preSpeechPadMs: ENDPOINTING_CONFIG.preSpeechPadMs,
        minSpeechMs: ENDPOINTING_CONFIG.minSpeechMs,
        processorType: "auto",
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
    if (Date.now() - started > ENDPOINTING_CONFIG.loadTimeoutMs) {
      await vad.destroy().catch(() => {});
      return null;
    }
    return vad;
  } catch {
    return null;
  }
}
