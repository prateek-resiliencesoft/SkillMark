"use client";

import { createLogger } from "@/lib/logger";
import {
  buildRelayTargets,
  isRecoverableRelayErrorMessage,
  RelayConnector,
  relayDisplayName,
  resolveRelayPrimaryPreference,
} from "@/lib/voice/relay-routing";
import {
  JITTER_BUFFER_MAX_WAIT_MS,
  JITTER_BUFFER_TARGET_MS,
  PLAYBACK_SAMPLE_RATE,
  nextJitterTargetMs,
  shouldFlushPlaybackQueue,
} from "@/lib/voice/playback-jitter-buffer";
import { BargeInDetector, SilenceCheck, stuckTurnReason, hasRecentVoiceEnergy } from "@/lib/voice/turn-guard";
import { VAD_FAILSAFE_CONFIG } from "@/lib/voice/vad-failsafe";
import { decideEndpoint } from "@/lib/voice/endpointing";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";
import {
  startInterviewVad,
  preloadVadAssets,
  lastVadStartError,
  activeVadProcessor,
  type InterviewVad,
} from "@/lib/voice/silero-vad-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportSessionError } from "@/lib/session-error-report-client";
import { VadFailsafe, type FailsafeReason } from "@/lib/voice/vad-failsafe";
import { compareUserLines, normalizeForCompare } from "@/lib/transcript/dedupe";

const PLAYBACK_START_LEAD_S = 0.18;
// Short fade-in when playback (re)starts from silence, to avoid a click.
const PLAYBACK_FADE_IN_SAMPLES = 96; // 4ms at 24kHz

const log = createLogger("voice");

/** ~3s of 256ms mic chunks kept so a VAD fallback doesn't lose the words that triggered it. */
const PRE_ROLL_CHUNKS = 12;
/** Max audio held while the relay reconnects the AI with its own speech detection (~10s). */
const FALLBACK_QUEUE_MAX_CHUNKS = 40;
/** Speaker-echo guard after AI audio ends (the old hold was 500ms and swallowed quick answers). */
const AI_ECHO_GUARD_MS = 150;
/** Stop holding audio for the fallback reconnect after this long, even without confirmation. */
const FALLBACK_QUEUE_TIMEOUT_MS = 8_000;

function float32ToPcmHex(inputData: Float32Array): string {
  const pcm = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export interface InterviewContext {
  title: string;
  objective?: string | null;
  aiName: string;
  aiGender?: string;
  aiTone: string;
  language: string;
  followUpDepth: string;
  startQuestionIndex?: number;
  candidateFocus?: { skills?: string[] | null; questions?: Array<{ text: string; skill?: string | null }> | null } | null;
  questions: Array<{
    text: string;
    type: string;
    description?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any;
    starterCode?: { language: string; code: string } | null;
    order: number;
    skipIf?: { answerContainsAny?: string[]; reason?: string } | null;
  }>;
}

interface UseVoiceOptions {
  interviewId: string;
  sessionId: string;
  interviewContext: InterviewContext;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onQuestionChange?: (index: number, total: number) => void;
  onTtsChunk?: (pcmData: ArrayBuffer) => void;
  onInterrupt?: () => void;
}

interface VoiceState {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  isTransitioning: boolean;
  transitionDirection: "next" | "previous" | null;
  isSaving: boolean;
  isInterviewComplete: boolean;
  userTranscript: string;
  aiTranscript: string;
  lastAssistantUtteranceEndedAt: number;
  audioLevel: number;
  currentQuestionIndex: number;
  totalQuestions: number;
  /** Candidate stayed silent through the spoken checks — show "we can't hear you". */
  micCheckPrompt: boolean;
  /** Voice connection dropped and is retrying (show "Reconnecting…"). */
  isReconnecting: boolean;
}

interface TrackedMessage {
  role: "user" | "assistant";
  content: string;
  source?: "voice" | "chat";
  /** ISO speak-time from the client (not server insert time). */
  timestamp: string;
  /** Monotonic sequence for stable ordering within a session. */
  seq: number;
}

/**
 * Voice interview hook using Volcengine S2S (Speech-to-Speech) via relay.
 *
 * Flow:
 * 1. Browser connects and sends interview context to relay
 * 2. Relay builds system prompt and connects to Volcengine
 * 3. Browser captures mic audio as 16kHz int16 PCM
 * 4. Audio sent to relay server via WebSocket (hex-encoded)
 * 5. Relay forwards to Volcengine S2S which handles ASR + LLM + TTS
 * 6. TTS audio (24kHz float32 PCM) streamed back and played via AudioContext
 * 7. Per-question transitions managed by relay with LLM summarization
 * 8. On disconnect, all messages are saved to database
 */
export function useVoice({
  sessionId,
  interviewContext,
  onTranscript,
  onAIResponse,
  onError,
  onQuestionChange,
  onTtsChunk,
  onInterrupt,
}: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>({
    isConnected: false,
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    isTransitioning: false,
    transitionDirection: null,
    isSaving: false,
    isInterviewComplete: false,
    userTranscript: "",
    aiTranscript: "",
    lastAssistantUtteranceEndedAt: 0,
    audioLevel: 0,
    currentQuestionIndex: interviewContext.startQuestionIndex ?? 0,
    totalQuestions: interviewContext.questions.length,
    micCheckPrompt: false,
    isReconnecting: false,
  });

  const relayConnectorRef = useRef<RelayConnector<Record<string, unknown>> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any>(null);
  const playTimeRef = useRef(0);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const queuedAudioChunksRef = useRef<Float32Array[]>([]);
  const queuedAudioSamplesRef = useRef(0);
  const firstQueuedAudioAtRef = useRef<number | null>(null);
  const playbackFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const isListeningRef = useRef(false);
  const trackedMessagesRef = useRef<TrackedMessage[]>([]);
  const msgSeqRef = useRef(0);
  /** Serialize progress saves so earlier questions never insert after later ones. */
  const saveChainRef = useRef(Promise.resolve());
  const micHoldUntilRef = useRef(0);
  /** When AI audio actually stops playing (micHoldUntil adds a 500ms echo tail on top). */
  const aiAudioEndsAtRef = useRef(0);
  const bargeInFramesRef = useRef(0);
  /** Consecutive confident Silero frames after the AI finished (turn opener when onSpeechStart was swallowed). */
  const postAiSpeechFramesRef = useRef(0);
  /** Sustained-speech detector for cutting the AI's voice (barge-in). */
  const bargeInDetectorRef = useRef(new BargeInDetector());
  /** Latest mic chunk level (float32 RMS), for barge-in and silence checks. */
  const lastMicRmsRef = useRef(0);
  /** Last time the mic carried voice-level energy (outside AI playback). */
  const lastVoiceAtRef = useRef(0);
  /** When the current candidate turn was opened. */
  const turnOpenedAtRef = useRef(0);
  /** Candidate just finished; the AI's reply is on its way (don't let a blip cut it). */
  const awaitingAiReplyUntilRef = useRef(0);
  /** "Hello, are you there?" state machine. */
  const silenceCheckRef = useRef(new SilenceCheck());
  /** Loudest mic level since the "Are you there?" check (no signal at all → mic box). */
  const micPeakSinceCheckRef = useRef(0);
  const relayReconnectingRef = useRef(false);
  const interviewCompleteRef = useRef(false);
  const isSpeakingRef = useRef(false);
  /** Adaptive playback pre-roll (grows after gaps in the AI's voice). */
  const jitterTargetMsRef = useRef<number>(JITTER_BUFFER_TARGET_MS);
  /** True between the first chunk of an AI reply and its end (for gap counting). */
  const aiReplyPlayingRef = useRef(false);
  const underrunsThisReplyRef = useRef(0);
  const playbackReportsRef = useRef(0);
  const bargeInReportsRef = useRef(0);

  // VAD failsafe: falls back to the AI's own speech detection if Silero misses the candidate.
  const vadFailsafeRef = useRef(new VadFailsafe());
  /** Recent mic chunks (hex PCM) not sent while client VAD gated them. */
  const preRollRef = useRef<string[]>([]);
  /** Audio held while the relay reconnects after a VAD fallback. */
  const fallbackQueueRef = useRef<string[] | null>(null);
  const fallbackQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client Silero VAD + smart endpointing
  const clientVadEnabledRef = useRef(false);
  const vadRef = useRef<InterviewVad | null>(null);
  const turnActiveRef = useRef(false);
  const silenceStartedAtRef = useRef<number | null>(null);
  const speechStartedAtRef = useRef<number | null>(null);
  const liveTranscriptRef = useRef("");
  const endpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkInSentForQuestionRef = useRef(false);
  const lastTurnEndedAtRef = useRef(0);
  /** Cumulative speech ms this turn (survives mid-answer pauses). */
  const turnSpeechMsRef = useRef(0);
  const lastSpeechSegmentStartRef = useRef<number | null>(null);
  const currentQuestionForCheckInRef = useRef(
    interviewContext.startQuestionIndex ?? 0,
  );

  const onInterruptRef = useRef(onInterrupt);
  useEffect(() => { onInterruptRef.current = onInterrupt; }, [onInterrupt]);
  const lastFinalUserTranscriptRef = useRef<{ text: string; at: number; questionIndex: number } | null>(null);

  // Buffers for accumulating streaming chunks
  const asrBufferRef = useRef<string>("");
  const chatBufferRef = useRef<string>("");
  const lastOnAIResponseRef = useRef<string>("");
  const currentQuestionIndexRef = useRef(
    interviewContext.startQuestionIndex ?? 0
  );
  const latestCodeUpdateRef = useRef<{ content: string; language: string } | null>(
    null
  );
  const latestWhiteboardUpdateRef = useRef<string | null>(null);

  useEffect(() => {
    currentQuestionIndexRef.current = state.currentQuestionIndex;
  }, [state.currentQuestionIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(() => {
    stopListening();
    interruptPlayback();
    relayConnectorRef.current?.close();
    relayConnectorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      isProcessing: false,
      isTransitioning: false,
      transitionDirection: null,
      userTranscript: "",
      aiTranscript: "",
      lastAssistantUtteranceEndedAt: 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPlaybackFlushTimer = useCallback(() => {
    if (playbackFlushTimerRef.current) {
      clearTimeout(playbackFlushTimerRef.current);
      playbackFlushTimerRef.current = null;
    }
  }, []);

  const clearQueuedAudio = useCallback(() => {
    clearPlaybackFlushTimer();
    queuedAudioChunksRef.current = [];
    queuedAudioSamplesRef.current = 0;
    firstQueuedAudioAtRef.current = null;
  }, [clearPlaybackFlushTimer]);

  /** Stop all currently playing audio sources and notify recording mixer */
  const interruptPlayback = useCallback(() => {
    clearQueuedAudio();
    for (const source of audioSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    audioSourcesRef.current = [];
    playTimeRef.current = 0;
    micHoldUntilRef.current = performance.now() + 250;
    aiAudioEndsAtRef.current = performance.now();
    bargeInFramesRef.current = 0;
    bargeInDetectorRef.current.reset();
    aiReplyPlayingRef.current = false;
    isSpeakingRef.current = false;
    setState((s) => ({ ...s, isSpeaking: false }));
    onInterruptRef.current?.();
  }, [clearQueuedAudio]);

  /** AI audio playing (plus a short echo tail), or its reply is on the way. */
  const isAiBusy = useCallback(
    (now: number) =>
      now < aiAudioEndsAtRef.current + AI_ECHO_GUARD_MS || now < awaitingAiReplyUntilRef.current,
    [],
  );

  const scheduleQueuedAudioFlush = useCallback(
    (flushQueuedAudio: (force?: boolean) => void) => {
      if (playbackFlushTimerRef.current) return;
      const firstQueuedAt = firstQueuedAudioAtRef.current;
      const delayMs =
        typeof firstQueuedAt === "number"
          ? Math.max(0, JITTER_BUFFER_MAX_WAIT_MS - (performance.now() - firstQueuedAt))
          : JITTER_BUFFER_MAX_WAIT_MS;
      playbackFlushTimerRef.current = setTimeout(() => {
        playbackFlushTimerRef.current = null;
        flushQueuedAudio(true);
      }, delayMs);
    },
    []
  );

  const flushQueuedAudio = useCallback((force = false) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (queuedAudioSamplesRef.current === 0) return;
    // A suspended/interrupted context never plays (or plays in bursts) — wake it.
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const bufferedAheadMs = Math.max(0, (playTimeRef.current - now) * 1000);
    if (
      !force &&
      !shouldFlushPlaybackQueue({
        queuedSamples: queuedAudioSamplesRef.current,
        bufferedAheadMs,
        firstChunkQueuedAtMs: firstQueuedAudioAtRef.current,
        nowMs: performance.now(),
        sampleRate: PLAYBACK_SAMPLE_RATE,
        targetMs: jitterTargetMsRef.current,
      })
    ) {
      scheduleQueuedAudioFlush(flushQueuedAudio);
      return;
    }

    clearPlaybackFlushTimer();

    const float32 = new Float32Array(queuedAudioSamplesRef.current);
    let offset = 0;
    for (const chunk of queuedAudioChunksRef.current) {
      float32.set(chunk, offset);
      offset += chunk.length;
    }

    queuedAudioChunksRef.current = [];
    queuedAudioSamplesRef.current = 0;
    firstQueuedAudioAtRef.current = null;

    const coldStart = playTimeRef.current <= now;
    if (coldStart && aiReplyPlayingRef.current) {
      // Ran dry in the middle of an AI reply → audible gap. Build a bigger
      // cushion from now on so the voice doesn't break up again.
      underrunsThisReplyRef.current += 1;
      jitterTargetMsRef.current = nextJitterTargetMs(jitterTargetMsRef.current);
      log.warn(`AI audio underrun (gap) — pre-roll now ${jitterTargetMsRef.current}ms`);
    }
    aiReplyPlayingRef.current = true;
    silenceCheckRef.current.aiStarted();
    if (coldStart) {
      const n = Math.min(PLAYBACK_FADE_IN_SAMPLES, float32.length);
      for (let i = 0; i < n; i++) float32[i] *= i / n;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Schedule playback sequentially
    // Contiguous when already playing; after an underrun / at turn start add a
    // small lead so the next chunks can arrive before this one runs out.
    const startAt = playTimeRef.current > now ? playTimeRef.current : now + PLAYBACK_START_LEAD_S;
    source.start(startAt);
    playTimeRef.current = startAt + audioBuffer.duration;
    aiAudioEndsAtRef.current =
      performance.now() + Math.max(0, (playTimeRef.current - now) * 1000);
    micHoldUntilRef.current = aiAudioEndsAtRef.current + 500;
    bargeInFramesRef.current = 0;

    audioSourcesRef.current.push(source);
    awaitingAiReplyUntilRef.current = 0;
    isSpeakingRef.current = true;
    setState((s) => ({
      ...s,
      isSpeaking: true,
      isProcessing: false,
    }));

    source.onended = () => {
      audioSourcesRef.current = audioSourcesRef.current.filter(
        (s) => s !== source
      );
      if (
        audioSourcesRef.current.length === 0 &&
        queuedAudioSamplesRef.current === 0
      ) {
        isSpeakingRef.current = false;
        silenceCheckRef.current.aiFinished(performance.now());
        setState((s) => ({ ...s, isSpeaking: false }));
      }
    };
  }, [clearPlaybackFlushTimer, scheduleQueuedAudioFlush]);

  /** Queue incoming float32 PCM audio chunk and flush through a small jitter buffer. */
  const playAudio = useCallback(
    (pcmData: ArrayBuffer) => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const float32 = new Float32Array(pcmData);
      if (float32.length === 0) return;

      if (firstQueuedAudioAtRef.current === null) {
        firstQueuedAudioAtRef.current = performance.now();
      }
      queuedAudioChunksRef.current.push(float32);
      queuedAudioSamplesRef.current += float32.length;
      // Background tabs throttle timers to ~1s, which turned the jitter-buffer
      // wait into long gaps. Schedule straight away when hidden.
      const hidden = typeof document !== "undefined" && document.hidden;
      flushQueuedAudio(hidden);
    },
    [flushQueuedAudio]
  );

  const replayLatestRelayContext = useCallback(
    (connector?: RelayConnector<Record<string, unknown>> | null) => {
      const client = connector ?? relayConnectorRef.current;
      if (!client) return;

      const latestCode = latestCodeUpdateRef.current;
      if (latestCode) {
        client.sendJson({
          type: "code_update",
          content: latestCode.content,
          language: latestCode.language,
        });
      }

      const latestWhiteboard = latestWhiteboardUpdateRef.current;
      if (latestWhiteboard) {
        client.sendJson({
          type: "whiteboard_update",
          imageDataUrl: latestWhiteboard,
        });
      }
    },
    []
  );

  /** Connect to the voice relay server */
  const connect = useCallback(async () => {
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create AudioContext for playback
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" });
      }
      // Browsers can create the context suspended (autoplay policy); resume it
      // inside this user-initiated call so the first words aren't lost.
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume().catch(() => {});
      }

      // Prefer client Silero VAD; fall back to Gemini automatic VAD if assets fail.
      const vadAssetsOk = await preloadVadAssets();
      clientVadEnabledRef.current = vadAssetsOk;
      vadFailsafeRef.current = new VadFailsafe();
      preRollRef.current = [];
      fallbackQueueRef.current = null;
      if (!vadAssetsOk) {
        log.warn("Silero VAD assets unavailable — using Gemini automatic VAD");
        reportSessionError(sessionId, {
          category: "voice",
          severity: "info",
          message: "Browser speech detection unavailable (assets did not load) — using the AI's own speech detection",
          context: { stage: "client_vad_off", reason: "assets_unavailable" },
        });
      } else {
        log.info("Client VAD on (Silero)");
      }

      // Reset tracked messages
      trackedMessagesRef.current = [];
      msgSeqRef.current = 0;
      saveChainRef.current = Promise.resolve();

      relayConnectorRef.current?.close();

      const targets = buildRelayTargets({
        language: interviewContext.language,
        voiceRelayUrl: process.env.NEXT_PUBLIC_VOICE_RELAY_URL,
        openAiRelayUrl: process.env.NEXT_PUBLIC_OPENAI_VOICE_RELAY_URL,
        primaryPreference: resolveRelayPrimaryPreference(
          process.env.NEXT_PUBLIC_VOICE_RELAY_PRIMARY,
        ),
        browserProtocol:
          typeof window !== "undefined" ? window.location.protocol : undefined,
        browserHost:
          typeof window !== "undefined" ? window.location.host : undefined,
      });

      const connector = new RelayConnector<Record<string, unknown>>({
        targets,
        binaryType: "arraybuffer",
        buildInitMessage: () => ({
          type: "init",
          sessionId,
          clientVad: clientVadEnabledRef.current,
          context: {
            ...interviewContext,
            startQuestionIndex: currentQuestionIndexRef.current,
          },
        }),
        onJsonMessage: (msg) => {
          handleRelayMessage(msg);
        },
        onBinaryMessage: (data) => {
          playAudio(data);
          onTtsChunk?.(data);
        },
        onConnected: ({ target, isFailover, connector: activeConnector }) => {
          log.info(
            `${isFailover ? "Failed over to" : "Connected to"} ${relayDisplayName(
              target.kind
            )} @ ${target.url}`
          );
          relayReconnectingRef.current = false;
          setState((s) => (s.isReconnecting ? { ...s, isReconnecting: false } : s));
          if (isFailover) {
            replayLatestRelayContext(activeConnector);
          }
        },
        onFailover: ({ from, to, reason }) => {
          log.warn(
            `Relay failover: ${relayDisplayName(from.kind)} -> ${relayDisplayName(
              to.kind
            )} (${reason})`
          );
          reportSessionError(sessionId, {
            category: "voice",
            severity: "warning",
            message: `Voice relay failover: ${relayDisplayName(from.kind)} -> ${relayDisplayName(to.kind)} (${reason})`,
            context: { stage: "relay_failover", from: from.kind, to: to.kind },
          });
        },
        // Keep trying for ~1 minute (network blips) before giving up.
        retryDelaysMs: [1_000, 2_000, 4_000, 8_000, 15_000, 30_000],
        onReconnecting: ({ round, totalRounds, lastError }) => {
          log.warn(`Voice relay unreachable (${lastError.message}) — retry ${round}/${totalRounds}`);
          relayReconnectingRef.current = true;
          setState((s) => ({ ...s, isReconnecting: true }));
          if (round === 1) {
            reportSessionError(sessionId, {
              category: "voice",
              severity: "warning",
              message: `Voice connection lost (${lastError.message}) — reconnecting`,
              context: { stage: "relay_reconnecting" },
            });
          }
        },
        onPermanentFailure: (error) => {
          relayReconnectingRef.current = false;
          setState((s) => ({ ...s, isReconnecting: false }));
          log.error("Voice relay exhausted all targets:", error.message);
          reportSessionError(sessionId, {
            category: "voice",
            severity: "error",
            message: error.message || "Voice relay websocket error (all relays failed)",
            context: { stage: "relay_permanent_failure" },
          });
          setState((s) => ({ ...s, isConnected: false }));
          onError?.(
            error.message || "Voice connection error. Is the relay server running?"
          );
        },
      });

      relayConnectorRef.current = connector;
      await connector.connect();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Voice connection failed";
      reportSessionError(sessionId, { category: "voice", message: msg, context: { stage: "connect" } });
      onError?.(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError, playAudio, interviewContext]);

  /** Extract text from a Volcengine event payload, trying common field names */
  const extractText = useCallback(
    (data: Record<string, unknown> | undefined): string => {
      if (!data) return "";
      for (const key of ["text", "content", "sentence", "delta"]) {
        if (typeof data[key] === "string" && data[key]) return data[key] as string;
      }
      return "";
    },
    []
  );

  const trackMessage = useCallback(
    (msg: Omit<TrackedMessage, "timestamp" | "seq">) => {
      msgSeqRef.current += 1;
      trackedMessagesRef.current.push({
        ...msg,
        timestamp: new Date().toISOString(),
        seq: msgSeqRef.current,
      });
    },
    [],
  );

  /** Save accumulated messages to the server (incremental, non-completing).
   *  Called on each question transition so progress is not lost. */
  const saveProgress = useCallback(
    async (currentQuestionIndex: number) => {
      // Flush any remaining ASR buffer (chatBuffer is already cleared
      // before this is called by the question_change handler).
      const pendingAsrText = asrBufferRef.current.trim();
      if (pendingAsrText) {
        trackMessage({ role: "user", content: pendingAsrText });
        asrBufferRef.current = "";
      }

      const messages = [...trackedMessagesRef.current];
      trackedMessagesRef.current = []; // clear so next question starts fresh

      if (messages.length === 0 && typeof currentQuestionIndex !== "number") return;

      const run = async () => {
        try {
          const res = await fetch("/api/voice/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, messages, currentQuestionIndex }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          log.info(
            `Progress saved: ${messages.length} msgs, Q${currentQuestionIndex + 1}`,
          );
        } catch (err) {
          // Put unsaved messages back so final complete / retry can still persist them
          trackedMessagesRef.current = [...messages, ...trackedMessagesRef.current];
          log.error("Failed to save progress:", err);
          reportSessionError(sessionId, {
            category: "client",
            severity: "warning",
            message: `Failed to save voice progress: ${err instanceof Error ? err.message : String(err)}`,
            context: { stage: "voice_save", questionIndex: currentQuestionIndex },
          });
        }
      };

      // Queue saves so question N never inserts after N+1 on the wire
      const next = saveChainRef.current.then(run, run);
      saveChainRef.current = next.then(
        () => undefined,
        () => undefined,
      );
      await next;
    },
    [sessionId, trackMessage],
  );

  /** Send audio held during a VAD-fallback reconnect, then resume live streaming. */
  const flushFallbackQueue = useCallback(() => {
    if (fallbackQueueTimerRef.current) {
      clearTimeout(fallbackQueueTimerRef.current);
      fallbackQueueTimerRef.current = null;
    }
    const queued = fallbackQueueRef.current;
    fallbackQueueRef.current = null;
    const connector = relayConnectorRef.current;
    if (!queued?.length || !connector?.isReady) return;
    for (const hex of queued) connector.sendJson({ type: "audio", data: hex });
    log.info(`VAD fallback: sent ${queued.length} held mic chunks`);
  }, []);

  /**
   * Give up on browser (Silero) turn detection for the rest of this session.
   * The relay reconnects the AI with its own speech detection and the mic is
   * streamed continuously (with the usual echo guard while the AI talks).
   */
  const switchToServerVad = useCallback(
    (reason: FailsafeReason, extra?: Record<string, unknown>) => {
      if (!clientVadEnabledRef.current) return;
      const connector = relayConnectorRef.current;
      const snapshot = vadFailsafeRef.current.snapshot();
      vadFailsafeRef.current.trip(reason);

      // Close any half-open client turn so the AI doesn't wait on it.
      if (endpointTimerRef.current) {
        clearInterval(endpointTimerRef.current);
        endpointTimerRef.current = null;
      }
      if (turnActiveRef.current && connector?.isReady) {
        connector.sendJson({ type: "activity_end" });
      }
      turnActiveRef.current = false;
      silenceStartedAtRef.current = null;
      clientVadEnabledRef.current = false;

      // Hold the words that triggered this (pre-roll) plus whatever is said
      // while the relay reconnects, then send them once it's back.
      fallbackQueueRef.current = [...preRollRef.current];
      preRollRef.current = [];
      if (fallbackQueueTimerRef.current) clearTimeout(fallbackQueueTimerRef.current);
      fallbackQueueTimerRef.current = setTimeout(() => {
        fallbackQueueTimerRef.current = null;
        flushFallbackQueue();
      }, FALLBACK_QUEUE_TIMEOUT_MS);

      connector?.sendJson({ type: "client_vad", enabled: false, reason });

      const vad = vadRef.current;
      vadRef.current = null;
      if (vad) {
        void vad.pause().catch(() => {});
        void vad.destroy().catch(() => {});
      }

      log.warn(`Client VAD off (fallback: ${reason})`, snapshot);
      reportSessionError(sessionId, {
        category: "voice",
        severity: "warning",
        message: `Browser speech detection missed the candidate (${reason}) — switched to the AI's own speech detection`,
        context: {
          stage: "client_vad_fallback",
          reason,
          questionIndex: currentQuestionIndexRef.current,
          ...snapshot,
          ...extra,
        },
      });
    },
    [flushFallbackQueue, sessionId],
  );

  /**
   * Save whatever the AI has said so far as an interviewer line. Called before
   * the text buffer is cleared (barge-in, button transitions, question change)
   * so interviewer lines aren't silently dropped from the transcript.
   */
  const commitAssistantBuffer = useCallback(() => {
    const text = chatBufferRef.current.trim();
    chatBufferRef.current = "";
    if (!text) return "";
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized !== lastOnAIResponseRef.current.replace(/\s+/g, " ").trim()) {
      lastOnAIResponseRef.current = text;
      onAIResponse?.(text);
      trackMessage({ role: "assistant", content: text });
    }
    return text;
  }, [onAIResponse, trackMessage]);

  /** Handle JSON messages from relay */
  const handleRelayMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: Record<string, any>) => {
      switch (msg.type) {
        case "ready":
          log.info("Session ready:", msg.sessionId);
          setState((s) => ({ ...s, isConnected: true }));
          break;

        case "turn_force_ended":
          // The server closed a candidate turn that was left open (no speech end).
          if (endpointTimerRef.current) {
            clearInterval(endpointTimerRef.current);
            endpointTimerRef.current = null;
          }
          if (turnActiveRef.current) {
            turnActiveRef.current = false;
            lastTurnEndedAtRef.current = performance.now();
            silenceStartedAtRef.current = null;
            lastSpeechSegmentStartRef.current = null;
            speechStartedAtRef.current = null;
            setState((s) => ({ ...s, isProcessing: true }));
          }
          log.warn(`Server closed a stuck candidate turn (${String(msg.reason)})`);
          break;

        case "silence_prompt_ignored":
        case "silence_check_ignored":
          // Relay was busy (reply pending, AI talking) — retry the same reminder later.
          silenceCheckRef.current.promptRejected(performance.now(), ENDPOINTING_CONFIG.silenceCheckSuppressMs);
          break;

        case "no_answer_skip_ignored":
          // Relay was busy (candidate turn / reply in flight) — try again later.
          silenceCheckRef.current.skipRejected(performance.now(), ENDPOINTING_CONFIG.silenceCheckSuppressMs);
          break;

        case "interrupt":
          interruptPlayback();
          setState((s) => ({ ...s, isProcessing: false }));
          if (chatBufferRef.current.trim()) {
            const text = commitAssistantBuffer();
            setState((s) => ({ ...s, aiTranscript: text }));
          }
          break;

        case "asr": {
          // ASR transcript chunk from Volcengine — accumulate.
          const results =
            (msg.data?.results as Array<Record<string, unknown>>) || [];
          if (results.length > 0) {
            const text = (results[0].text as string) || "";
            if (text.trim()) {
              if (text.trim().length > asrBufferRef.current.length) {
                vadFailsafeRef.current.transcript(text.trim().length - asrBufferRef.current.length);
              }
              asrBufferRef.current = text.trim();
              liveTranscriptRef.current = text.trim();
              // Transcribed words = genuine speech (also covers server-VAD fallback).
              if (/[\p{L}\p{N}]{2,}/u.test(text)) silenceCheckRef.current.candidateActivity();
              setState((s) => ({ ...s, userTranscript: text }));
              onTranscript?.(text, false);
            }
          }
          break;
        }

        case "asr_ended": {
          const finalText =
            (typeof msg.text === "string" && msg.text.trim()) || asrBufferRef.current;
          if (finalText) {
            vadFailsafeRef.current.transcript(finalText.length);
            const normalized = normalizeForCompare(finalText);
            const lastFinal = lastFinalUserTranscriptRef.current;
            const qIdx = currentQuestionIndexRef.current;
            // Same question, same (or nearly the same) words as the last line → a
            // repeat, whatever the time gap (re-sent buffer, or the candidate
            // repeating because the AI went quiet).
            const kind =
              lastFinal && lastFinal.questionIndex === qIdx
                ? compareUserLines(lastFinal.text, finalText)
                : null;
            const prevWords = lastFinal ? lastFinal.text.split(" ").length : 0;
            const newWords = normalized.split(" ").length;
            const skip =
              kind === "same" ||
              kind === "contained" ||
              (kind === "similar" && newWords <= prevWords * 1.25);

            if (skip) {
              log.debug(`Skipping repeated USER final (${kind}): "${normalized.slice(0, 60)}..."`);
            } else {
              lastFinalUserTranscriptRef.current = { text: normalized, at: Date.now(), questionIndex: qIdx };
              onTranscript?.(finalText, true);
              // Grown version of the line still waiting to be saved → replace it.
              const pending = trackedMessagesRef.current;
              const lastPending = pending[pending.length - 1];
              if ((kind === "extends" || kind === "similar") && lastPending?.role === "user") {
                lastPending.content = finalText;
              } else {
                trackMessage({ role: "user", content: finalText });
              }
              log.debug(
                `Tracked USER: "${finalText.slice(0, 60)}..."`
              );
            }
          }
          asrBufferRef.current = "";
          // Their words are final; if the AI never replies, reminders still run.
          if (finalText && !turnActiveRef.current) silenceCheckRef.current.candidateFinished(performance.now());
          setState((s) => ({
            ...s,
            userTranscript: "",
            isProcessing: !!finalText,
          }));
          break;
        }

        case "chat": {
          const text = extractText(msg.data);
          if (text) {
            chatBufferRef.current += text;
            setState((s) => ({
              ...s,
              aiTranscript: chatBufferRef.current,
              lastAssistantUtteranceEndedAt: 0,
              isProcessing: false,
            }));
          }
          break;
        }

        case "tts_text": {
          const text = extractText(msg.data);
          if (text) {
            chatBufferRef.current += (chatBufferRef.current ? " " : "") + text;
            setState((s) => ({
              ...s,
              aiTranscript: chatBufferRef.current,
              lastAssistantUtteranceEndedAt: 0,
              isProcessing: false,
            }));
            log.debug(
              `TTS sentence: "${text.slice(0, 80)}..."`
            );
          }
          break;
        }

        case "tts_sentence_end":
          break;

        case "chat_ended":
        case "tts_ended": {
          if (msg.type === "tts_ended") {
            aiReplyPlayingRef.current = false;
            const gaps = underrunsThisReplyRef.current;
            underrunsThisReplyRef.current = 0;
            if (gaps > 0 && playbackReportsRef.current < 8) {
              playbackReportsRef.current += 1;
              reportSessionError(sessionId, {
                category: "voice",
                severity: gaps >= 3 ? "warning" : "info",
                message: `AI voice had ${gaps} gap${gaps === 1 ? "" : "s"} in one reply (audio arrived slower than it played)`,
                context: {
                  stage: "playback_underrun",
                  gaps,
                  preRollMs: jitterTargetMsRef.current,
                  hidden: typeof document !== "undefined" ? document.hidden : undefined,
                  questionIndex: currentQuestionIndexRef.current,
                },
              });
            }
          }
          const fullResponse = chatBufferRef.current.trim();
          chatBufferRef.current = "";
          // Keep last transcript visible until next AI speech (replaced by tts_text/chat)
          setState((s) => ({
            ...s,
            aiTranscript: fullResponse,
            lastAssistantUtteranceEndedAt:
              msg.type === "tts_ended" ? Date.now() : s.lastAssistantUtteranceEndedAt,
            isProcessing: false,
          }));
          if (fullResponse) {
            // Dedupe: chat_ended and tts_ended often both fire for same response.
            // Use dedicated ref — trackedMessagesRef can lag; normalize for comparison.
            const normalized = fullResponse.replace(/\s+/g, " ").trim();
            const lastSent = lastOnAIResponseRef.current.replace(/\s+/g, " ").trim();
            if (normalized === lastSent) {
              log.debug(`Skipping duplicate ASSISTANT (${msg.type})`);
            } else {
              lastOnAIResponseRef.current = fullResponse;
              onAIResponse?.(fullResponse);
              trackMessage({ role: "assistant", content: fullResponse });
              log.debug(
                `Tracked ASSISTANT (${msg.type}): "${fullResponse.slice(0, 60)}..."`
              );
            }
          }
          break;
        }

        case "session_reconnecting":
          relayReconnectingRef.current = true;
          silenceCheckRef.current.suppress(performance.now(), ENDPOINTING_CONFIG.silenceCheckSuppressMs);
          interruptPlayback();
          if (chatBufferRef.current.trim()) {
            const text = chatBufferRef.current.trim();
            lastOnAIResponseRef.current = text;
            onAIResponse?.(text);
            trackMessage({ role: "assistant", content: text });
          }
          chatBufferRef.current = "";
          lastOnAIResponseRef.current = "";
          setState((s) => ({ ...s, aiTranscript: "", isProcessing: true }));
          break;

        case "session_reconnected":
          relayReconnectingRef.current = false;
          silenceCheckRef.current.suppress(performance.now(), ENDPOINTING_CONFIG.silenceCheckSuppressMs);
          setState((s) => ({ ...s, isProcessing: false }));
          if (fallbackQueueRef.current) flushFallbackQueue();
          break;

        case "question_change": {
          // For manual transitions, interrupt immediately so old audio
          // doesn't bleed into the new question. For auto-transitions
          // the wrap-up acknowledgement ("好的，谢谢分享") may still be
          // playing — let it finish naturally; the new question's audio
          // will be queued after it via sequential scheduling.
          if (!msg.auto) {
            interruptPlayback();
          }
          // Keep what the AI already said for the previous question (it used to be
          // discarded here, which dropped interviewer lines from the transcript).
          commitAssistantBuffer();
          lastOnAIResponseRef.current = "";
          const idx = msg.questionIndex as number;
          const total = msg.totalQuestions as number;

          // Persist messages from the previous question (fire-and-forget)
          saveProgress(idx);

          // Safety net: the mic carried voice during that question but nothing
          // was transcribed — the AI probably never heard the answer.
          {
            const prevIdx = currentQuestionForCheckInRef.current;
            const q = vadFailsafeRef.current.endQuestion();
            if (idx !== prevIdx && vadFailsafeRef.current.questionMissed(q)) {
              reportSessionError(sessionId, {
                category: "voice",
                severity: "warning",
                message: `Question ${prevIdx + 1}: the mic picked up ~${Math.round(q.voicedMs / 1000)}s of speech but no answer was transcribed`,
                context: {
                  stage: "question_without_transcript",
                  questionIndex: prevIdx,
                  voicedMs: Math.round(q.voicedMs),
                  vadTurnsOpened: q.turnsOpened,
                  clientVad: clientVadEnabledRef.current,
                },
              });
              if (clientVadEnabledRef.current) {
                switchToServerVad("question_without_transcript", { voicedMs: Math.round(q.voicedMs) });
              }
            }
          }

          checkInSentForQuestionRef.current = false;
          currentQuestionForCheckInRef.current = idx;
          silenceCheckRef.current.reset();
          liveTranscriptRef.current = "";
          setState((s) => ({
            ...s,
            currentQuestionIndex: idx,
            totalQuestions: total,
              isTransitioning: false,
              transitionDirection: null,
              aiTranscript: "",
              lastAssistantUtteranceEndedAt: 0,
            }));
          onQuestionChange?.(idx, total);
          log.info(`Question ${idx + 1}/${total}`);
          break;
        }

        case "transitioning": {
          const dir = (msg.direction as "next" | "previous") ?? "next";
          if (!msg.auto) {
            interruptPlayback();
            commitAssistantBuffer();
            setState((s) => ({
              ...s,
              isTransitioning: true,
              transitionDirection: dir,
              isSpeaking: false,
              aiTranscript: "",
              lastAssistantUtteranceEndedAt: 0,
            }));
          } else {
            setState((s) => ({
              ...s,
              isTransitioning: true,
              transitionDirection: dir,
            }));
          }
          break;
        }

        case "interview_complete":
          log.info("Interview complete, wrapping up");
          interviewCompleteRef.current = true;
          silenceCheckRef.current.reset();
          setState((s) => ({ ...s, isInterviewComplete: true }));
          break;

        case "error": {
          const message = (msg.message as string) || "Relay error";
          reportSessionError(sessionId, {
            category: /tts|speech|asr|stt/i.test(message) ? "tts_stt" : "voice",
            severity: isRecoverableRelayErrorMessage(message) ? "warning" : "error",
            message,
            context: { stage: "relay_error_message" },
          });
          if (
            isRecoverableRelayErrorMessage(message) &&
            relayConnectorRef.current?.canFailover
          ) {
            log.warn(`Recoverable relay error ignored during failover window: ${message}`);
            break;
          }
          onError?.(message);
          break;
        }

        case "disconnected":
          reportSessionError(sessionId, {
            category: "voice",
            severity: "warning",
            message: "Voice relay reported disconnected",
            context: { stage: "relay_disconnected" },
          });
          setState((s) => ({ ...s, isConnected: false }));
          if (relayConnectorRef.current?.canFailover) {
            void relayConnectorRef.current.failover("relay disconnected message");
          }
          break;
      }
    },
    [interruptPlayback, extractText, onTranscript, onAIResponse, onError, onQuestionChange, saveProgress, sessionId, trackMessage, flushFallbackQueue, switchToServerVad, commitAssistantBuffer]
  );

  const clearEndpointTimer = useCallback(() => {
    if (endpointTimerRef.current) {
      clearInterval(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }
  }, []);

  const sendActivity = useCallback((type: "activity_start" | "activity_end") => {
    const connector = relayConnectorRef.current;
    if (!connector?.isReady || !clientVadEnabledRef.current) return;
    connector.sendJson({ type });
  }, []);

  const finishUserTurn = useCallback(
    (action: "end_turn" | "check_in") => {
      clearEndpointTimer();
      silenceStartedAtRef.current = null;
      if (!turnActiveRef.current) return;
      turnActiveRef.current = false;
      lastTurnEndedAtRef.current = performance.now();
      // Close out the current speech segment timing.
      if (lastSpeechSegmentStartRef.current != null) {
        turnSpeechMsRef.current += Math.max(
          0,
          performance.now() - lastSpeechSegmentStartRef.current,
        );
        lastSpeechSegmentStartRef.current = null;
      }

      // Close the audio turn first so Gemini finalizes what they said, then
      // optionally cue a once-per-question gentle check-in for hesitant answers.
      sendActivity("activity_end");
      // If the AI then never replies, the silence reminders still run.
      silenceCheckRef.current.candidateFinished(performance.now());
      // The AI's reply is on its way: a breath or noise right now must not
      // reopen the turn and cut that reply (needs sustained speech instead).
      awaitingAiReplyUntilRef.current = performance.now() + ENDPOINTING_CONFIG.continuationWindowMs;
      if (action === "check_in" && !checkInSentForQuestionRef.current) {
        checkInSentForQuestionRef.current = true;
        silenceCheckRef.current.suppress(performance.now(), ENDPOINTING_CONFIG.silenceCheckSuppressMs);
        relayConnectorRef.current?.sendJson({
          type: "answer_check_in",
          transcript: liveTranscriptRef.current,
          questionIndex: currentQuestionForCheckInRef.current,
        });
      }
      speechStartedAtRef.current = null;
      // Keep liveTranscript briefly so a fast continuation can still see context;
      // it is cleared when a fresh turn starts outside the continuation window.
      setState((s) => ({ ...s, isProcessing: true }));
    },
    [clearEndpointTimer, sendActivity],
  );

  const beginUserTurn = useCallback(() => {
    // Speech resumed (or started): cancel any end-of-turn / check-in countdown.
    clearEndpointTimer();
    silenceStartedAtRef.current = null;
    const now = performance.now();
    if (turnActiveRef.current) {
      // Already in an open turn (pause inside the answer) — resume segment timer.
      if (lastSpeechSegmentStartRef.current == null) {
        lastSpeechSegmentStartRef.current = now;
      }
      return;
    }

    const continuing =
      lastTurnEndedAtRef.current > 0 &&
      now - lastTurnEndedAtRef.current < ENDPOINTING_CONFIG.continuationWindowMs;

    turnActiveRef.current = true;
    turnOpenedAtRef.current = now;
    lastVoiceAtRef.current = now;
    awaitingAiReplyUntilRef.current = 0;
    silenceCheckRef.current.candidateActivity();
    setState((s) => (s.micCheckPrompt ? { ...s, micCheckPrompt: false } : s));
    if (continuing) {
      // Candidate kept talking after a premature end — barge in and reopen.
      interruptPlayback();
      if (!speechStartedAtRef.current) speechStartedAtRef.current = now;
    } else {
      speechStartedAtRef.current = now;
      turnSpeechMsRef.current = 0;
      liveTranscriptRef.current = "";
    }
    lastSpeechSegmentStartRef.current = now;
    // Barge-in: stop local AI playback when the candidate really starts talking.
    if (now < aiAudioEndsAtRef.current + AI_ECHO_GUARD_MS) {
      const remainingMs = Math.round(aiAudioEndsAtRef.current - now);
      interruptPlayback();
      if (remainingMs > 300 && bargeInReportsRef.current < 10) {
        bargeInReportsRef.current += 1;
        reportSessionError(sessionId, {
          category: "voice",
          severity: "info",
          message: "AI voice stopped because the candidate started talking (barge-in)",
          context: {
            stage: "barge_in",
            cutMs: remainingMs,
            micRms: Number(lastMicRmsRef.current.toFixed(4)),
            questionIndex: currentQuestionIndexRef.current,
          },
        });
      }
    }
    vadFailsafeRef.current.turnOpened();
    sendActivity("activity_start");
    // Silero fires a little after the first syllable — send the last mic chunk
    // (held back by the gate) so the start of the answer isn't clipped.
    const lastChunk = preRollRef.current[preRollRef.current.length - 1];
    preRollRef.current = [];
    if (lastChunk && clientVadEnabledRef.current) {
      relayConnectorRef.current?.sendJson({ type: "audio", data: lastChunk });
    }
  }, [clearEndpointTimer, interruptPlayback, sendActivity, sessionId]);

  const scheduleEndpointCheck = useCallback(() => {
    clearEndpointTimer();
    const now = performance.now();
    silenceStartedAtRef.current = now;
    // Freeze speech duration for this pause (don't count silence as speech).
    if (lastSpeechSegmentStartRef.current != null) {
      turnSpeechMsRef.current += Math.max(0, now - lastSpeechSegmentStartRef.current);
      lastSpeechSegmentStartRef.current = null;
    }
    endpointTimerRef.current = setInterval(() => {
      if (!turnActiveRef.current || silenceStartedAtRef.current == null) return;
      const silenceMs = performance.now() - silenceStartedAtRef.current;
      const speechDurationMs = turnSpeechMsRef.current;
      const decision = decideEndpoint({
        silenceMs,
        transcript: liveTranscriptRef.current,
        speechDurationMs,
      });
      if (!decision.shouldEnd) return;
      if (decision.action === "check_in" || decision.action === "end_turn") {
        finishUserTurn(decision.action);
      }
    }, 200);
  }, [clearEndpointTimer, finishUserTurn]);

  /** Start capturing microphone audio and sending to relay */
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(ctx.destination);

      // Optional Silero VAD on the same mic stream (self-hosted /vad assets).
      if (clientVadEnabledRef.current && !vadRef.current) {
        // startInterviewVad never throws (worklet → retry → ScriptProcessor → null).
        // Before, a worklet load failure threw out of startListening, so the mic
        // processor below was never wired up and Silero never ran.
        const vad = await startInterviewVad({
          getStream: async () => mediaStreamRef.current ?? stream,
          onSpeechStart: () => {
            // Noise gate: Silero alone can call wind / fan / keyboard noise
            // "speech". Only open a turn when the mic also had voice-level energy
            // above the room's noise floor in the last moment.
            if (!hasRecentVoiceEnergy(performance.now(), lastVoiceAtRef.current)) {
              return;
            }
            // While the AI is talking (or its reply is on the way), ignore
            // normal-threshold starts — cutting the AI needs sustained,
            // confident speech (BargeInDetector in onSpeechProb).
            // Speech that starts after the AI stopped (past a short echo guard)
            // is the candidate answering quickly, so it opens the turn.
            if (isAiBusy(performance.now()) && !turnActiveRef.current) {
              return;
            }
            beginUserTurn();
          },
          onSpeechEnd: () => {
            if (!turnActiveRef.current) return;
            scheduleEndpointCheck();
          },
          onMisfire: () => {
            // Silero dropped a too-short segment without onSpeechEnd. If that
            // segment had (re)opened our turn, start the end-of-turn countdown
            // anyway — otherwise the turn stays open forever.
            if (turnActiveRef.current && silenceStartedAtRef.current == null) {
              scheduleEndpointCheck();
            }
          },
          onSpeechProb: (probability) => {
            const now = performance.now();
            vadFailsafeRef.current.vadFrame(now);
            const aiBusy = isAiBusy(now);
            // Candidate kept talking from inside the AI's audio into silence:
            // Silero's onSpeechStart was swallowed above and won't fire again
            // for this segment, so open the turn from the frame stream.
            if (!turnActiveRef.current && !aiBusy) {
              if (probability >= ENDPOINTING_CONFIG.positiveSpeechThreshold) {
                postAiSpeechFramesRef.current += 1;
                if (
                  postAiSpeechFramesRef.current >= ENDPOINTING_CONFIG.minSpeechFrames &&
                  hasRecentVoiceEnergy(now, lastVoiceAtRef.current)
                ) {
                  postAiSpeechFramesRef.current = 0;
                  beginUserTurn();
                }
              } else {
                postAiSpeechFramesRef.current = 0;
              }
            } else {
              postAiSpeechFramesRef.current = 0;
            }
            // While the AI is talking (or about to), only barge in on
            // sustained (~400ms), confident, loud-enough speech — echo,
            // breaths and short noises no longer cut the AI's voice.
            if (!aiBusy || turnActiveRef.current) {
              bargeInDetectorRef.current.reset();
              return;
            }
            if (bargeInDetectorRef.current.feed(probability, lastMicRmsRef.current)) {
              beginUserTurn();
            }
          },
        });
        if (vad) {
          vadRef.current = vad;
          vadFailsafeRef.current.vadStarted(performance.now());
          log.info(`Silero VAD started (client endpointing, ${activeVadProcessor ?? "?"})`);
          if (activeVadProcessor === "ScriptProcessor") {
            reportSessionError(sessionId, {
              category: "voice",
              severity: "info",
              message: "Browser speech detection started without an audio worklet (older audio method used)",
              context: { stage: "client_vad_script_processor", reason: lastVadStartError ?? undefined },
            });
          }
        } else {
          clientVadEnabledRef.current = false;
          relayConnectorRef.current?.sendJson({ type: "client_vad", enabled: false, reason: "vad_start_failed" });
          log.warn("Silero VAD failed to start — falling back to automatic VAD");
          reportSessionError(sessionId, {
            category: "voice",
            severity: "info",
            message: "Browser speech detection failed to start — using the AI's own speech detection",
            context: { stage: "client_vad_off", reason: "vad_start_failed", error: lastVadStartError ?? undefined },
          });
        }
      }

      processor.onaudioprocess = (event) => {
        if (!isListeningRef.current) return;
        const connector = relayConnectorRef.current;
        if (!connector?.isReady) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Compute RMS audio level (float32 range 0..1)
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) sumSq += inputData[i] * inputData[i];
        const rms = Math.sqrt(sumSq / inputData.length);
        const level = Math.min(1, rms * 5);
        setState((s) => ({ ...s, audioLevel: level }));

        const now = performance.now();
        const aiSpeaking = now < micHoldUntilRef.current;
        lastMicRmsRef.current = rms;
        if (rms > micPeakSinceCheckRef.current) micPeakSinceCheckRef.current = rms;

        // Voice-level energy (relative to the room's noise floor). Outside AI
        // playback it means the candidate is talking → no "are you there?".
        const floor = vadFailsafeRef.current.noiseFloorRms;
        const voiceRms = Math.max(
          VAD_FAILSAFE_CONFIG.absoluteMinRms * 2,
          floor != null ? floor * VAD_FAILSAFE_CONFIG.noiseFloorRatio : 0,
        );
        // Energy alone is NOT speech (fan, keyboard, traffic): it never resets the
        // silence reminders. Only a gated VAD turn or transcribed words do.
        if (!aiSpeaking && rms >= voiceRms) {
          lastVoiceAtRef.current = now;
        }

        // Stuck-turn guard: a turn opened but never closed (missed speech end)
        // leaves the AI waiting forever. Close it so the AI replies.
        if (clientVadEnabledRef.current && turnActiveRef.current) {
          const stuck = stuckTurnReason({
            now,
            turnOpenedAt: turnOpenedAtRef.current,
            lastVoiceAt: lastVoiceAtRef.current,
            endpointPending: endpointTimerRef.current != null,
          });
          if (stuck) {
            log.warn(`Closing stuck candidate turn (${stuck})`);
            reportSessionError(sessionId, {
              category: "voice",
              severity: "warning",
              message: `Candidate turn was left open (${stuck === "no_voice" ? "no speech for a while" : "very long turn"}) — closed so the AI can reply`,
              context: {
                stage: "stuck_turn_client",
                reason: stuck,
                openMs: Math.round(now - turnOpenedAtRef.current),
                questionIndex: currentQuestionIndexRef.current,
              },
            });
            finishUserTurn("end_turn");
          }
        }

        // Failsafe: voice on the mic but Silero never opens a turn → switch the
        // session to the AI's own speech detection (see vad-failsafe.ts).
        const trigger = vadFailsafeRef.current.micChunk(
          {
            now,
            rms,
            durationMs: (inputData.length / event.inputBuffer.sampleRate) * 1000,
            aiSpeaking,
            turnActive: turnActiveRef.current,
          },
          clientVadEnabledRef.current,
        );
        if (trigger) switchToServerVad(trigger, { rms: Number(rms.toFixed(4)) });

        if (clientVadEnabledRef.current) {
          // With client VAD: only stream mic audio while a user turn is open
          // (activityStart..activityEnd). Echo during AI speech is dropped
          // unless Silero confirmed a barge-in (turnActive).
          if (!turnActiveRef.current) {
            if (!aiSpeaking) {
              preRollRef.current.push(float32ToPcmHex(inputData));
              if (preRollRef.current.length > PRE_ROLL_CHUNKS) preRollRef.current.shift();
            } else if (preRollRef.current.length) {
              preRollRef.current = [];
            }
            return;
          }
        } else if (aiSpeaking) {
          // Automatic-VAD fallback: classic half-duplex echo guard.
          bargeInFramesRef.current = 0;
          return;
        }

        const hex = float32ToPcmHex(inputData);
        const queue = fallbackQueueRef.current;
        if (queue) {
          // Relay is reconnecting the AI after a VAD fallback — hold, don't drop.
          queue.push(hex);
          if (queue.length > FALLBACK_QUEUE_MAX_CHUNKS) queue.shift();
          return;
        }

        connector.sendJson({ type: "audio", data: hex });
      };

      processorRef.current = { processor, source, ctx };
      isListeningRef.current = true;
      setState((s) => ({ ...s, isListening: true, userTranscript: "" }));
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Microphone access failed";
      reportSessionError(sessionId, { category: "tts_stt", message: `Microphone: ${msg}`, context: { stage: "mic" } });
      onError?.(msg);
    }
  }, [
    beginUserTurn,
    finishUserTurn,
    isAiBusy,
    onError,
    scheduleEndpointCheck,
    sessionId,
    switchToServerVad,
  ]);

  /** Stop capturing microphone */
  const stopListening = useCallback(() => {
    // Close an open candidate turn first. Before, muting the mic mid-turn
    // dropped it silently and the next activity_start reopened on top of it
    // (the AI never got a turn end and never replied).
    if (turnActiveRef.current && clientVadEnabledRef.current && relayConnectorRef.current?.isReady) {
      relayConnectorRef.current.sendJson({ type: "activity_end" });
      lastTurnEndedAtRef.current = performance.now();
    }
    isListeningRef.current = false;
    clearEndpointTimer();
    preRollRef.current = [];
    fallbackQueueRef.current = null;
    if (fallbackQueueTimerRef.current) {
      clearTimeout(fallbackQueueTimerRef.current);
      fallbackQueueTimerRef.current = null;
    }
    turnActiveRef.current = false;
    silenceStartedAtRef.current = null;
    speechStartedAtRef.current = null;

    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) {
      void vad.pause().catch(() => {});
      void vad.destroy().catch(() => {});
    }

    if (processorRef.current) {
      const { processor, source, ctx } = processorRef.current;
      processor.disconnect();
      source.disconnect();
      ctx.close();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setState((s) => ({ ...s, isListening: false, audioLevel: 0 }));
  }, [clearEndpointTimer]);

  /** Request transition to the next question */
  const nextQuestion = useCallback(() => {
    relayConnectorRef.current?.sendJson({ type: "next_question" });
  }, []);

  /** Request transition back to the previous question */
  const previousQuestion = useCallback(() => {
    relayConnectorRef.current?.sendJson({ type: "prev_question" });
  }, []);

  /** Send a text message through the relay (treated like a voice utterance).
   *  The caller is responsible for adding the message to the UI display;
   *  this method only tracks it for server persistence and sends it to the relay. */
  const sendTextMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const connector = relayConnectorRef.current;
      if (!connector?.isReady) return;

      trackMessage({ role: "user", content: trimmed, source: "chat" });
      silenceCheckRef.current.candidateActivity();
      setState((s) => (s.micCheckPrompt ? { ...s, micCheckPrompt: false } : s));
      vadFailsafeRef.current.transcript(trimmed.length);
      connector.sendJson({ type: "text_input", content: trimmed });
    },
    [trackMessage],
  );

  /** Send code editor content to the relay for agent context */
  const sendCodeUpdate = useCallback((content: string, language: string) => {
    latestCodeUpdateRef.current = { content, language };
    relayConnectorRef.current?.sendJson({ type: "code_update", content, language });
  }, []);

  /** Send whiteboard image to the relay for agent context */
  const sendWhiteboardUpdate = useCallback((imageDataUrl: string) => {
    latestWhiteboardUpdateRef.current = imageDataUrl;
    relayConnectorRef.current?.sendJson({ type: "whiteboard_update", imageDataUrl });
  }, []);

  /** Save remaining tracked messages and complete the session */
  const saveAndComplete = useCallback(async () => {
    // Wait for any in-flight question progress saves first
    try {
      await saveChainRef.current;
    } catch {
      /* already logged in saveProgress */
    }

    // Flush any pending buffers before saving
    const pendingAsrText = asrBufferRef.current.trim();
    if (pendingAsrText) {
      trackMessage({ role: "user", content: pendingAsrText });
      asrBufferRef.current = "";
    }
    const pendingChatText = chatBufferRef.current.trim();
    if (pendingChatText) {
      trackMessage({ role: "assistant", content: pendingChatText });
      chatBufferRef.current = "";
    }

    const messages = [...trackedMessagesRef.current];
    trackedMessagesRef.current = [];
    if (messages.length === 0 && !sessionId) return;

    log.info(
      `Saving ${messages.length} remaining messages and completing session`,
    );

    try {
      const res = await fetch("/api/voice/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messages,
          complete: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      trackedMessagesRef.current = [...messages, ...trackedMessagesRef.current];
      log.error("Failed to save voice data:", err);
    }
  }, [sessionId, trackMessage]);

  // ── Silent-candidate check + stuck "AI speaking" guard (every 500ms) ──
  useEffect(() => {
    if (!state.isConnected) return;
    const timer = setInterval(() => {
      const now = performance.now();

      // isSpeaking can't stay stuck if a source's onended never fires
      // (suspended context, tab throttling) — it would hide the mic UI.
      if (isSpeakingRef.current && now > aiAudioEndsAtRef.current + 1_500 && queuedAudioSamplesRef.current === 0) {
        isSpeakingRef.current = false;
        audioSourcesRef.current = [];
        silenceCheckRef.current.aiFinished(now);
        setState((s) => ({ ...s, isSpeaking: false }));
      }

      if (interviewCompleteRef.current || !isListeningRef.current) return;
      const connector = relayConnectorRef.current;
      if (!connector?.isReady) return;
      // Genuine speech in progress. Client VAD: an open turn / gated speech
      // segment. Server-VAD fallback (no client turns): voice-level energy above
      // the adaptive noise floor only PAUSES the count (never resets it), so a
      // candidate who is talking is never skipped; the relay also refuses while
      // it hears them.
      const speechInProgress = clientVadEnabledRef.current
        ? lastSpeechSegmentStartRef.current != null
        : now - lastVoiceAtRef.current < 1_500;
      const action = silenceCheckRef.current.tick(now, {
        turnActive: turnActiveRef.current,
        aiBusy: isSpeakingRef.current || isAiBusy(now) || relayReconnectingRef.current || queuedAudioSamplesRef.current > 0,
        speechInProgress,
      });
      if (!action) return;
      if (action.type === "prompt") {
        log.info(`Candidate silent — reminder ${action.stage}: "${action.text}"`);
        if (action.stage === 1) micPeakSinceCheckRef.current = 0;
        connector.sendJson({
          type: "silence_prompt",
          stage: action.stage,
          text: action.text,
          questionIndex: currentQuestionIndexRef.current,
        });
      } else {
        const noSignal = micPeakSinceCheckRef.current < ENDPOINTING_CONFIG.noMicSignalRms;
        log.warn(`Candidate still silent after all reminders — moving to the next question${noSignal ? " (mic shows no signal)" : ""}`);
        connector.sendJson({
          type: "no_answer_skip",
          policy: action.policy,
          questionIndex: currentQuestionIndexRef.current,
        });
        if (noSignal) setState((s) => ({ ...s, micCheckPrompt: true }));
        reportSessionError(sessionId, {
          category: "voice",
          severity: "warning",
          message: noSignal
            ? "Candidate did not answer and the microphone showed no signal — moved on and asked them on screen to check the mic"
            : "Candidate did not answer after three reminders — moved to the next question",
          context: {
            stage: "no_answer_skip",
            questionIndex: currentQuestionIndexRef.current,
            micPeakRms: Number(micPeakSinceCheckRef.current.toFixed(4)),
          },
        });
      }
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isConnected, sessionId]);

  const dismissMicCheckPrompt = useCallback(() => {
    silenceCheckRef.current.candidateActivity();
    setState((s) => ({ ...s, micCheckPrompt: false }));
  }, []);

  /** Disconnect, save messages, and clean up everything */
  const disconnect = useCallback(async () => {
    setState((s) => ({ ...s, isSaving: true }));
    try {
      await saveAndComplete();
    } finally {
      cleanup();
      // isSaving is reset by cleanup
    }
  }, [saveAndComplete, cleanup]);

  return {
    ...state,
    connect,
    disconnect,
    startListening,
    stopListening,
    nextQuestion,
    previousQuestion,
    sendTextMessage,
    sendCodeUpdate,
    sendWhiteboardUpdate,
    interruptPlayback,
    dismissMicCheckPrompt,
    mediaStreamRef,
  };
}
