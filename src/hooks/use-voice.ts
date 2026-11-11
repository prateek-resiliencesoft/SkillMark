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
  PLAYBACK_SAMPLE_RATE,
  shouldFlushPlaybackQueue,
} from "@/lib/voice/playback-jitter-buffer";
import { decideEndpoint } from "@/lib/voice/endpointing";
import { ENDPOINTING_CONFIG } from "@/lib/voice/endpointing-config";
import {
  createInterviewVad,
  preloadVadAssets,
  type InterviewVad,
} from "@/lib/voice/silero-vad-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportSessionError } from "@/lib/session-error-report-client";

const PLAYBACK_START_LEAD_S = 0.18;
// Short fade-in when playback (re)starts from silence, to avoid a click.
const PLAYBACK_FADE_IN_SAMPLES = 96; // 4ms at 24kHz

const log = createLogger("voice");

export interface InterviewContext {
  title: string;
  objective?: string | null;
  aiName: string;
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
  const bargeInFramesRef = useRef(0);

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
  const lastFinalUserTranscriptRef = useRef<{ text: string; at: number } | null>(null);

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
    bargeInFramesRef.current = 0;
    setState((s) => ({ ...s, isSpeaking: false }));
    onInterruptRef.current?.();
  }, [clearQueuedAudio]);

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
    micHoldUntilRef.current =
      performance.now() + Math.max(0, (playTimeRef.current - now) * 1000) + 500;
    bargeInFramesRef.current = 0;

    audioSourcesRef.current.push(source);
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
      flushQueuedAudio();
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
      if (!vadAssetsOk) {
        log.warn("Silero VAD assets unavailable — using Gemini automatic VAD");
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
        onPermanentFailure: (error) => {
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

  /** Handle JSON messages from relay */
  const handleRelayMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: Record<string, any>) => {
      switch (msg.type) {
        case "ready":
          log.info("Session ready:", msg.sessionId);
          setState((s) => ({ ...s, isConnected: true }));
          break;

        case "interrupt":
          interruptPlayback();
          setState((s) => ({ ...s, isProcessing: false }));
          if (chatBufferRef.current.trim()) {
            const text = chatBufferRef.current.trim();
            setState((s) => ({ ...s, aiTranscript: text }));
            chatBufferRef.current = "";
          }
          break;

        case "asr": {
          // ASR transcript chunk from Volcengine — accumulate.
          const results =
            (msg.data?.results as Array<Record<string, unknown>>) || [];
          if (results.length > 0) {
            const text = (results[0].text as string) || "";
            if (text.trim()) {
              asrBufferRef.current = text.trim();
              liveTranscriptRef.current = text.trim();
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
            const normalized = finalText.replace(/\s+/g, " ").trim().toLowerCase();
            const lastFinal = lastFinalUserTranscriptRef.current;
            const isDuplicateFinal =
              !!lastFinal &&
              lastFinal.text === normalized &&
              Date.now() - lastFinal.at < 15_000;

            if (isDuplicateFinal) {
              log.debug(`Skipping duplicate USER final: "${normalized.slice(0, 60)}..."`);
            } else {
              lastFinalUserTranscriptRef.current = { text: normalized, at: Date.now() };
              onTranscript?.(finalText, true);
              trackMessage({ role: "user", content: finalText });
              log.debug(
                `Tracked USER: "${finalText.slice(0, 60)}..."`
              );
            }
          }
          asrBufferRef.current = "";
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
          setState((s) => ({ ...s, isProcessing: false }));
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
          // Discard transition greeting text before saving progress
          chatBufferRef.current = "";
          lastOnAIResponseRef.current = "";
          const idx = msg.questionIndex as number;
          const total = msg.totalQuestions as number;

          // Persist messages from the previous question (fire-and-forget)
          saveProgress(idx);

          checkInSentForQuestionRef.current = false;
          currentQuestionForCheckInRef.current = idx;
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
            chatBufferRef.current = "";
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
    [interruptPlayback, extractText, onTranscript, onAIResponse, onError, onQuestionChange, saveProgress, sessionId, trackMessage]
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
      if (action === "check_in" && !checkInSentForQuestionRef.current) {
        checkInSentForQuestionRef.current = true;
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
    if (now < micHoldUntilRef.current) {
      interruptPlayback();
    }
    sendActivity("activity_start");
  }, [clearEndpointTimer, interruptPlayback, sendActivity]);

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
        const vad = await createInterviewVad({
          getStream: async () => mediaStreamRef.current ?? stream,
          onSpeechStart: () => {
            bargeInFramesRef.current = 0;
            // During AI playback, ignore normal-threshold starts — barge-in
            // requires a sustained high-confidence streak in onSpeechProb.
            if (performance.now() < micHoldUntilRef.current && !turnActiveRef.current) {
              return;
            }
            beginUserTurn();
          },
          onSpeechEnd: () => {
            if (!turnActiveRef.current) return;
            scheduleEndpointCheck();
          },
          onSpeechProb: (probability) => {
            // While the AI is talking, only barge in on sustained high-confidence speech.
            const aiSpeaking = performance.now() < micHoldUntilRef.current;
            if (!aiSpeaking || turnActiveRef.current) {
              bargeInFramesRef.current = 0;
              return;
            }
            if (probability >= ENDPOINTING_CONFIG.bargeInSpeechThreshold) {
              bargeInFramesRef.current += 1;
              if (bargeInFramesRef.current >= ENDPOINTING_CONFIG.bargeInMinFrames) {
                bargeInFramesRef.current = 0;
                beginUserTurn();
              }
            } else {
              bargeInFramesRef.current = 0;
            }
          },
        });
        if (vad) {
          vadRef.current = vad;
          await vad.start();
          log.info("Silero VAD started (client endpointing)");
        } else {
          clientVadEnabledRef.current = false;
          relayConnectorRef.current?.sendJson({ type: "client_vad", enabled: false });
          log.warn("Silero VAD failed to start — falling back to automatic VAD");
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

        const aiSpeaking = performance.now() < micHoldUntilRef.current;
        if (clientVadEnabledRef.current) {
          // With client VAD: only stream mic audio while a user turn is open
          // (activityStart..activityEnd). Echo during AI speech is dropped
          // unless Silero confirmed a barge-in (turnActive).
          if (!turnActiveRef.current) return;
        } else if (aiSpeaking) {
          // Automatic-VAD fallback: classic half-duplex echo guard.
          bargeInFramesRef.current = 0;
          return;
        }

        // Convert float32 to int16 PCM
        const pcm = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }

        // Send as hex-encoded string
        const bytes = new Uint8Array(pcm.buffer);
        let hex = "";
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, "0");
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
    onError,
    scheduleEndpointCheck,
    sessionId,
  ]);

  /** Stop capturing microphone */
  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    clearEndpointTimer();
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
    mediaStreamRef,
  };
}
