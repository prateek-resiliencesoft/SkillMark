"use client";

import { PreparingScreen } from "@/components/session/preparing-screen";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AuralLogo } from "@/components/ui/aural-logo";
import { BrandWordmark } from "@/components/ui/brand-wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { InterviewContext } from "@/hooks/use-voice";
import { getMicTestSamplePhrase } from "@/lib/i18n";
import { createInterviewVad, type InterviewVad } from "@/lib/voice/silero-vad-client";
import {
  evaluateMicTest,
  MIC_TEST_CHECK,
  micTestAudioSrc,
} from "@/lib/voice/mic-test-check";
import {
    setCameraSkipped,
    setScreenSkipped,
    setStoredScreenStream,
} from "@/lib/media-stream-store";
import { cn } from "@/lib/utils";
import {
    AlertCircle,
    AudioLines,
    Calendar,
    Camera,
    CheckCircle2,
    Clock,
    Loader2,
    Monitor,
    RefreshCw,
    ScreenShare,
    User,
} from "lucide-react";
import { formatDateTime } from "@/lib/messaging/templates";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInterface } from "./chat-interface";
import { IntervieweeTourOverlay } from "./interviewee-tour-overlay";
import { IntervieweeTourProvider, useIntervieweeTour } from "./interviewee-tour-provider";
import { VoiceInterface } from "./voice-interface";

interface IntervieweeOnboardingProps {
  /** Lets the voice relay use the interview org's AI key for the mic test. */
  sessionId?: string;
  interviewTitle: string;
  interviewDescription?: string | null;
  questionCount: number;
  timeLimitMinutes?: number | null;
  language?: string;
  antiCheatingEnabled?: boolean;
  voiceEnabled?: boolean;
  chatEnabled?: boolean;
  aiName?: string;
  questionTypes?: string[];
  scheduledAt?: string | null;
  expiresAt?: string | null;
  /** Invite links are single-use: closing the tab or losing connection ends the interview. */
  oneTimeLink?: boolean;
  onComplete: () => void;
}

type OnboardingStep = "info" | "checklist" | "howItWorks";

const STEPS = [
  { key: "info" as const, label: "Interview Info" },
  { key: "checklist" as const, label: "Checklist" },
  { key: "enter" as const, label: "Start" },
];

function WelcomeIllustration() {
  return (
    <div className="border-b border-border/60 bg-muted/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/interview-tour-welcome.webp"
        alt="A candidate taking an interview on ResilienceSoft Interview"
        width={896}
        height={504}
        className="block aspect-video max-h-[34dvh] w-full object-cover"
      />
    </div>
  );
}

export function PreviewWrapper({
  onReady,
  children,
}: {
  onReady: () => void;
  children: React.ReactNode;
}) {
  const tour = useIntervieweeTour();
  const tourDone = tour?.finished ?? false;
  const [welcomed, setWelcomed] = useState(false);
  const showWelcome = !welcomed && !tour?.active && !tourDone;
  const readyFiredRef = useRef(false);

  const fireReady = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReady();
  }, [onReady]);

  const handleStartTour = useCallback(() => {
    setWelcomed(true);
    tour?.restart();
  }, [tour]);

  // Skipping the tour starts the interview straight away (still marks the tour as seen).
  const handleSkipTour = useCallback(() => {
    setWelcomed(true);
    tour?.skip();
    fireReady();
  }, [tour, fireReady]);

  // Finishing (or skipping mid-way through) the tour also starts the interview directly.
  useEffect(() => {
    if (tourDone) fireReady();
  }, [tourDone, fireReady]);

  return (
    <div className="relative flex h-[100dvh] flex-col bg-background">
      {children}

      {showWelcome && (
        <div className="absolute inset-0 z-[9997] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
            <WelcomeIllustration />
            <div className="space-y-2 px-6 pb-6 pt-5 text-center sm:px-8">
              <h3 className="text-xl font-semibold">Welcome to your interview</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Take a quick tour of the interview screen: voice controls,
                transcript, whiteboard and more, so you know where everything is.
              </p>
              <div className="flex items-stretch gap-3 pt-3">
                <Button
                  variant="ghost"
                  size="lg"
                  className="text-muted-foreground"
                  onClick={handleSkipTour}
                >
                  Skip for now
                </Button>
                <Button className="flex-1" size="lg" onClick={handleStartTour}>
                  Take a quick tour
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: OnboardingStep }) {
  const stepIdxMap: Record<OnboardingStep, number> = { info: 0, checklist: 1, howItWorks: 2 };
  const currentIdx = Math.min(stepIdxMap[current], STEPS.length - 1);

  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {STEPS.map((step, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;

        return (
          <div key={step.key} className="flex items-center gap-2">
            {idx > 0 && (
              <div
                className={cn(
                  "h-px w-12 sm:w-20",
                  isComplete ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                  isComplete
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "border border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={cn(
                  "hidden text-sm sm:inline",
                  isCurrent
                    ? "font-medium text-foreground"
                    : isComplete
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CameraCheck({
  done,
  onDone,
  allowSkip = true,
}: {
  done: boolean;
  onDone: () => void;
  allowSkip?: boolean;
}) {
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (streaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [streaming]);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      setPhoto(null);
      setStreaming(true);
    } catch {
      setError("Unable to access camera. Please check permissions.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopCamera();
    setPhoto(dataUrl);
    onDone();
  }, [stopCamera, onDone]);

  const retake = useCallback(() => {
    setPhoto(null);
    startCamera();
  }, [startCamera]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative h-36 w-44 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/50">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt="Captured photo"
                className="h-full w-full object-cover"
              />
            ) : streaming ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full scale-x-[-1] object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                <User className="h-10 w-10 text-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/50">
                  Keep your eyes on the camera
                </span>
              </div>
            )}
          </div>
          {!photo && !streaming && !done && (
            <Button size="sm" onClick={startCamera} className="w-full">
              <Camera className="mr-1.5 h-3.5 w-3.5" />
              Start Collecting
            </Button>
          )}
          {streaming && (
            <Button size="sm" onClick={capture} className="w-full">
              Capture
            </Button>
          )}
          {photo && (
            <Button size="sm" variant="outline" onClick={retake} className="w-full">
              <RefreshCw className="mr-1 h-3 w-3" />
              Retake
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium">
            The photo will be compared with snapshots during the interview, so
            please keep your face visible.
          </p>
          <p className="text-xs text-muted-foreground">
            Photo collection requires authorization, please operate according to
            browser prompts.
          </p>
          {error && (
            <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
              <button type="button" className="ml-auto font-medium underline" onClick={startCamera}>
                Retry
              </button>
            </div>
          )}
          {allowSkip && !error && !photo && !streaming && !done && (
            <p className="text-xs text-muted-foreground">
              No camera?{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowSkipDialog(true)}>
                Skip
              </button>
            </p>
          )}
          {!allowSkip && !error && !photo && !streaming && !done && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Camera is required for this interview.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center self-start pt-0.5">
          {done ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-secondary-600 dark:text-secondary-400">
              <CheckCircle2 className="h-4 w-4" />
              Collect photo
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2" />
              Collect photo
            </span>
          )}
        </div>
      </CardContent>
      <canvas ref={canvasRef} className="hidden" />
      <AlertDialog open={showSkipDialog} onOpenChange={setShowSkipDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip photo collection?</AlertDialogTitle>
            <AlertDialogDescription>
              Skipping photo collection is not recommended. The photo is used to
              verify your identity during the interview. Skipping may affect your
              interview results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setCameraSkipped(true); onDone(); }}>
              Skip anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type MicPhase =
  | "idle"
  | "requesting"
  | "playing"
  | "listening"
  | "playback"
  | "analyzing"
  | "confirm";

function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone permission was denied. Allow microphone access for this site (lock icon in the address bar), then retry.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect a microphone and retry.";
  if (name === "NotReadableError")
    return "Your microphone is in use by another app. Close it and retry.";
  return "Unable to access microphone. Please check permissions and retry.";
}

function MicCheck({
  done,
  onDone,
  language,
  allowSkip = true,
  sessionId,
}: {
  done: boolean;
  onDone: () => void;
  language?: string;
  allowSkip?: boolean;
  sessionId?: string;
}) {
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [level, setLevel] = useState(0);
  const [speakerOk, setSpeakerOk] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<InterviewVad | null>(null);
  const recordChunksRef = useRef<Float32Array[]>([]);
  const recordSamplesRef = useRef(0);
  const speechMsRef = useRef(0);
  const speechRmsSumRef = useRef(0);
  const speechFramesRef = useRef(0);
  const noiseRmsSumRef = useRef(0);
  const noiseFramesRef = useRef(0);
  const peakRef = useRef(0);
  const vadSpeakingRef = useRef(false);
  const finishedRef = useRef(false);

  const phaseRef = useRef<MicPhase>("idle");
  phaseRef.current = phase;

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const languageRef = useRef(language);
  languageRef.current = language;
  const samplePhrase = getMicTestSamplePhrase(language);

  const stopMicCapture = useCallback(() => {
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) {
      void vad.pause().catch(() => {});
      void vad.destroy().catch(() => {});
    }
    if (micCtxRef.current) {
      micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    setLevel(0);
  }, []);

  const stopSpeaker = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    stopSpeaker();
    stopMicCapture();
  }, [stopMicCapture, stopSpeaker]);

  const playRecordingPreview = useCallback(async () => {
    const chunks = recordChunksRef.current;
    if (!chunks.length) return;
    try {
      const total = recordSamplesRef.current;
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      // Cap preview ~4s
      const max = 16_000 * 4;
      const slice = merged.length > max ? merged.subarray(0, max) : merged;
      const ctx = new AudioContext({ sampleRate: 16_000 });
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const buf = ctx.createBuffer(1, slice.length, 16_000);
      buf.copyToChannel(slice, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      setPhase("playback");
      await new Promise<void>((resolve) => {
        src.onended = () => resolve();
        src.start();
        setTimeout(resolve, (slice.length / 16_000) * 1000 + 200);
      });
      await ctx.close().catch(() => {});
      audioCtxRef.current = null;
    } catch {
      /* preview is optional */
    }
  }, []);

  const passTest = useCallback(async () => {
    setFailMessage(null);
    setError(null);
    stopMicCapture();
    await playRecordingPreview();
    setPhase("idle");
    onDoneRef.current();
  }, [playRecordingPreview, stopMicCapture]);

  const failTest = useCallback(
    (message: string) => {
      stopMicCapture();
      setFailMessage(message);
      setError(null);
      setPhase("confirm");
    },
    [stopMicCapture],
  );

  const startListening = useCallback(async () => {
    finishedRef.current = false;
    speechMsRef.current = 0;
    speechRmsSumRef.current = 0;
    speechFramesRef.current = 0;
    noiseRmsSumRef.current = 0;
    noiseFramesRef.current = 0;
    peakRef.current = 0;
    vadSpeakingRef.current = false;
    recordChunksRef.current = [];
    recordSamplesRef.current = 0;
    setFailMessage(null);
    setPhase("listening");

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
      micStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      micCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});

      const vad = await createInterviewVad({
        getStream: async () => micStreamRef.current ?? stream,
        onSpeechStart: () => {
          vadSpeakingRef.current = true;
        },
        onSpeechEnd: () => {
          vadSpeakingRef.current = false;
        },
        onSpeechProb: (p) => {
          if (p >= 0.6) vadSpeakingRef.current = true;
        },
      });
      if (vad) {
        vadRef.current = vad;
        await vad.start();
      }

      const workletCode = `
        class MicProcessor extends AudioWorkletProcessor {
          constructor() { super(); this._buf = new Float32Array(4096); this._pos = 0; }
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (!ch) return true;
            for (let i = 0; i < ch.length; i++) {
              this._buf[this._pos++] = ch[i];
              if (this._pos >= 4096) {
                this.port.postMessage(this._buf);
                this._buf = new Float32Array(4096);
                this._pos = 0;
              }
            }
            return true;
          }
        }
        registerProcessor('mic-processor', MicProcessor);
      `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "mic-processor");
      source.connect(worklet);
      // Do not connect to destination (avoids feedback / echo into speakers).
      worklet.port.onmessage = (e) => {
        if (finishedRef.current) return;
        const input = e.data as Float32Array;
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const v = input[i];
          sum += v * v;
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sum / input.length);
        setLevel(Math.min(1, rms * 8));
        if (rms > peakRef.current) peakRef.current = rms;

        // Keep a short recording for optional playback (max ~5s).
        if (recordSamplesRef.current < 16_000 * 5) {
          recordChunksRef.current.push(new Float32Array(input));
          recordSamplesRef.current += input.length;
        }

        const frameMs = (input.length / ctx.sampleRate) * 1000;
        const isSpeech =
          vadSpeakingRef.current || rms >= MIC_TEST_CHECK.minSpeechRms;
        if (isSpeech) {
          speechMsRef.current += frameMs;
          speechRmsSumRef.current += rms;
          speechFramesRef.current += 1;
        } else {
          noiseRmsSumRef.current += rms;
          noiseFramesRef.current += 1;
        }

        if (speechMsRef.current >= MIC_TEST_CHECK.minSpeechMs) {
          finishedRef.current = true;
          const meanSpeech =
            speechFramesRef.current > 0
              ? speechRmsSumRef.current / speechFramesRef.current
              : 0;
          const noiseFloor =
            noiseFramesRef.current > 0
              ? noiseRmsSumRef.current / noiseFramesRef.current
              : undefined;
          const verdict = evaluateMicTest({
            speechMs: speechMsRef.current,
            peakRms: Math.max(peakRef.current, peak),
            meanSpeechRms: meanSpeech,
            noiseFloorRms: noiseFloor,
          });
          setPhase("analyzing");
          if (verdict.pass) {
            void passTest();
          } else {
            failTest(verdict.message);
          }
        }
      };
    } catch (err) {
      setError(describeMicError(err));
      setPhase("idle");
      stopMicCapture();
    }
  }, [failTest, passTest, stopMicCapture]);

  /**
   * Play the pre-generated Kore clip via a single HTMLAudioElement.
   * Avoids AudioContext sample-rate mismatches and never falls back to
   * browser speechSynthesis (that path sounded robotic).
   */
  const playSpeakerClip = useCallback(async () => {
    setError(null);
    setFailMessage(null);
    setPhase("requesting");
    stopSpeaker();

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setError(describeMicError(err));
      setPhase("idle");
      return;
    }

    setPhase("playing");

    const tryPlay = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = src;
        // Ensure no accidental pitch/tempo change.
        audio.playbackRate = 1;
        audio.defaultPlaybackRate = 1;
        audio.volume = 1;
        audioRef.current = audio;
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
        };
        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error(`Failed to play ${src}`));
        };
        const p = audio.play();
        if (p && typeof p.then === "function") {
          p.catch((err) => {
            cleanup();
            reject(err);
          });
        }
      });

    try {
      // Prefer 48 kHz MP3; fall back to 48 kHz WAV if MP3 fails to load.
      try {
        await tryPlay(micTestAudioSrc(languageRef.current, "mp3"));
      } catch {
        await tryPlay(micTestAudioSrc(languageRef.current, "wav"));
      }
      audioRef.current = null;
      setSpeakerOk(true);
      void startListening();
    } catch {
      audioRef.current = null;
      setError(
        "Could not play the speaker test clip. Check your speakers/volume and retry.",
      );
      setPhase("idle");
    }
  }, [startListening, stopSpeaker]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  // Unused sessionId kept for API parity with callers / future ASR.
  void sessionId;
  void skipped;

  const isBusy =
    phase === "requesting" ||
    phase === "playing" ||
    phase === "listening" ||
    phase === "playback" ||
    phase === "analyzing";

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative flex h-36 w-44 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/50">
            <AudioLines
              className={cn(
                "h-10 w-10 transition-colors",
                isBusy ? "text-primary" : "text-muted-foreground/30",
              )}
            />
            {phase === "playing" && (
              <div className="flex h-5 w-28 items-end justify-center gap-[3px]">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 animate-pulse rounded-full bg-primary"
                    style={{
                      height: `${4 + Math.random() * 14}px`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            )}
            {phase === "listening" && (
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                  <span className="text-[11px] font-medium text-destructive">
                    Listening...
                  </span>
                </div>
              </div>
            )}
            {phase === "playback" && (
              <span className="text-[11px] text-muted-foreground">Playing your mic back...</span>
            )}
            {(phase === "playing" ||
              phase === "listening" ||
              phase === "confirm") && (
              <div
                className="h-1.5 w-28 overflow-hidden rounded-full bg-muted-foreground/20"
                aria-label="Microphone level"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-75"
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
            )}
          </div>

          {phase === "idle" && !done && (
            <Button size="sm" onClick={() => void playSpeakerClip()} className="w-full">
              Test speaker & mic
            </Button>
          )}
          {phase === "playing" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stopAll();
                setPhase("idle");
              }}
              className="w-full"
            >
              Stop
            </Button>
          )}
          {(phase === "listening" || phase === "analyzing" || phase === "playback") && (
            <Button size="sm" variant="outline" disabled className="w-full">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {phase === "listening"
                ? "Listening..."
                : phase === "playback"
                  ? "Playing back..."
                  : "Checking..."}
            </Button>
          )}
          {phase === "confirm" && !done && (
            <Button size="sm" onClick={() => void playSpeakerClip()} className="w-full">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          )}
          {phase === "confirm" && !done && allowSkip && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stopAll();
                setPhase("idle");
                setSkipped(true);
                onDoneRef.current();
              }}
              className="w-full"
            >
              Continue anyway
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium">
            Test your speaker and microphone to ensure audio is working
            properly.
          </p>
          <p className="text-xs text-muted-foreground">
            {phase === "idle" && !done && (
              <>
                Click &quot;Test speaker &amp; mic&quot; to hear a short message
                in the interview voice, then say:{" "}
                <span className="font-medium text-foreground">
                  &quot;{samplePhrase}&quot;
                </span>
              </>
            )}
            {phase === "requesting" && "Granting microphone access..."}
            {phase === "playing" &&
              "Playing a clear sample in the interview voice — listen carefully."}
            {phase === "listening" && (
              <>
                Now say clearly:{" "}
                <span className="font-medium text-foreground">
                  &quot;{samplePhrase}&quot;
                </span>{" "}
                The level bar should move. We need about{" "}
                {Math.round(MIC_TEST_CHECK.minSpeechMs / 100) / 10}s of clear
                speech.
              </>
            )}
            {phase === "playback" &&
              "Playing back what we captured from your mic..."}
            {phase === "analyzing" && "Checking your voice..."}
            {phase === "confirm" && !done && (failMessage || "We couldn't hear you clearly. Please retry.")}
            {done &&
              "Audio test passed. Your speaker and microphone are working."}
          </p>
          {error && (
            <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
              <button
                type="button"
                className="ml-auto font-medium underline"
                onClick={() => void playSpeakerClip()}
              >
                Retry
              </button>
            </div>
          )}
          {allowSkip && !error && phase === "idle" && !done && (
            <p className="text-xs text-muted-foreground">
              No microphone?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setShowSkipDialog(true)}
              >
                Skip
              </button>
            </p>
          )}
          {!allowSkip && !error && phase === "idle" && !done && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Microphone is required for this interview.
            </p>
          )}
          {speakerOk && !done && phase === "listening" && (
            <p className="text-[11px] text-muted-foreground">Speaker clip played.</p>
          )}
        </div>

        <div className="flex shrink-0 items-center self-start pt-0.5">
          {done ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-secondary-600 dark:text-secondary-400">
              <CheckCircle2 className="h-4 w-4" />
              Microphone
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2" />
              Microphone
            </span>
          )}
        </div>
      </CardContent>
      <AlertDialog open={showSkipDialog} onOpenChange={setShowSkipDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip microphone test?</AlertDialogTitle>
            <AlertDialogDescription>
              Skipping the microphone test is not recommended. If your speaker or
              microphone is not working properly, it may affect your interview
              experience and results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPhase("idle");
                setSkipped(true);
                onDone();
              }}
            >
              Skip anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ScreenCheck({
  done,
  onDone,
  allowSkip = true,
}: {
  done: boolean;
  onDone: () => void;
  allowSkip?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [showSkipDialog, setShowSkipDialog] = useState(false);

  // getDisplayMedia is unavailable on iOS Safari and most mobile browsers
  const [isSupported, setIsSupported] = useState(true);
  const autoSkippedRef = useRef(false);

  useEffect(() => {
    const supported =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getDisplayMedia;
    setIsSupported(supported);
    if (!supported && !done && !autoSkippedRef.current) {
      autoSkippedRef.current = true;
      setScreenSkipped(true);
      onDone();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestShare = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      // Validate that the user shared the entire screen, not a tab or window
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings() as MediaTrackSettings & { displaySurface?: string };
      if (settings.displaySurface && settings.displaySurface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        setError(
          "Please share your entire screen, not a window or tab. Click \"Share Screen\" and select \"Entire Screen\"."
        );
        return;
      }

      const videoEl = document.createElement("video");
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      await videoEl.play();

      await new Promise((r) => setTimeout(r, 300));

      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext("2d")?.drawImage(videoEl, 0, 0);
      setThumbnail(canvas.toDataURL("image/jpeg", 0.7));

      // Keep the stream alive for the interview recording to reuse
      setStoredScreenStream(stream);
      videoEl.srcObject = null;
      onDone();
    } catch {
      setError("Screen capture was denied or cancelled.");
    }
  }, [onDone]);

  if (!isSupported) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Monitor className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">Screen sharing unavailable</p>
              <p className="text-xs text-muted-foreground">
                Screen sharing requires a desktop browser (Chrome recommended).
                This step has been automatically skipped on your device.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center self-start pt-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-secondary-600 dark:text-secondary-400">
              <CheckCircle2 className="h-4 w-4" />
              Skipped
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative flex h-36 w-44 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/50">
            {thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnail}
                alt="Screen capture preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <ScreenShare className="h-10 w-10 text-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/50">
                  Entire screen
                </span>
              </div>
            )}
          </div>
          {!done && (
            <Button size="sm" onClick={requestShare} className="w-full">
              <Monitor className="mr-1.5 h-3.5 w-3.5" />
              Share Screen
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium">
            Screen capture requires authorization.
          </p>
          <p className="text-xs text-muted-foreground">
            After clicking &quot;Share Screen&quot;, please select{" "}
            <span className="font-medium text-foreground">
              &quot;Entire Screen&quot;
            </span>{" "}
            in the pop-up window and click &quot;Share&quot;.
          </p>
          {error && (
            <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
              <button type="button" className="ml-auto font-medium underline" onClick={requestShare}>
                Retry
              </button>
            </div>
          )}
          {allowSkip && !error && !done && (
            <p className="text-xs text-muted-foreground">
              Can&apos;t share screen?{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowSkipDialog(true)}>
                Skip
              </button>
            </p>
          )}
          {!allowSkip && !error && !done && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Screen sharing is required for this interview.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center self-start pt-0.5">
          {done ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-secondary-600 dark:text-secondary-400">
              <CheckCircle2 className="h-4 w-4" />
              Screen Capture
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2" />
              Screen Capture
            </span>
          )}
        </div>
      </CardContent>
      <AlertDialog open={showSkipDialog} onOpenChange={setShowSkipDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip screen sharing?</AlertDialogTitle>
            <AlertDialogDescription>
              Skipping screen sharing is not recommended. Screen capture is used
              to monitor your interview environment. Skipping may affect your
              interview results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setScreenSkipped(true); onDone(); }}>
              Skip anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function IntervieweeOnboarding({
  sessionId,
  interviewTitle,
  interviewDescription,
  questionCount,
  timeLimitMinutes,
  language,
  antiCheatingEnabled = false,
  voiceEnabled = false,
  chatEnabled = false,
  aiName = "ResilienceSoft Interview",
  questionTypes = [],
  scheduledAt,
  expiresAt,
  oneTimeLink = false,
  onComplete,
}: IntervieweeOnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>("info");
  const [agreed, setAgreed] = useState(false);

  const [cameraDone, setCameraDone] = useState(false);
  const [micDone, setMicDone] = useState(false);
  const [screenDone, setScreenDone] = useState(false);
  const [starting, setStarting] = useState(false);

  const allChecksDone = cameraDone && micDone && screenDone;

  const handleComplete = useCallback(() => {
    setStarting(true);
    onComplete();
  }, [onComplete]);

  const header = (
    <header className="sticky top-0 z-50 flex h-14 items-center border-b bg-card px-4 sm:px-6">
      <div className="flex items-center gap-1">
        <AuralLogo size={28} className="shrink-0 sm:hidden" />
        <BrandWordmark height={36} className="hidden sm:inline-flex" />
      </div>
    </header>
  );

  if (step === "info") {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-muted/30">
        {header}
        <StepIndicator current="info" />
        <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 sm:px-6">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{interviewTitle}</h2>

              <div className="mt-4 flex gap-6 text-sm">
                <div>
                  <span className="font-medium">Description</span>
                  <p className="mt-1 text-muted-foreground">
                    {interviewDescription || "No additional description."}
                  </p>
                </div>
              </div>

              <div className="mt-2 text-sm text-muted-foreground">
                {questionCount} questions &middot;{" "}
                {timeLimitMinutes
                  ? `${timeLimitMinutes} min`
                  : "No time limit"}
              </div>

              {(scheduledAt || expiresAt) && (
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs space-y-1.5">
                  {scheduledAt && (
                    <div className="flex items-center gap-1.5 font-medium text-primary">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Scheduled for: {formatDateTime(scheduledAt)}</span>
                    </div>
                  )}
                  {expiresAt && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Link valid until: {formatDateTime(expiresAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {oneTimeLink && (
            <Card className="mt-4 border-destructive/40">
              <CardContent className="space-y-3 p-4 sm:p-6">
                <h3 className="font-semibold text-destructive">
                  Important: this link works only once
                </h3>
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                  Once you start, this interview cannot be paused, restarted or reopened.
                </div>
                <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
                  <li>
                    Your interview link is valid for <span className="font-medium text-foreground">one attempt only</span>.
                    After the interview ends, the link expires and cannot be opened again.
                  </li>
                  <li>
                    If you <span className="font-medium text-foreground">get disconnected from the internet</span>,
                    close this tab, or refresh the page, your link will expire and the
                    interview will be over.
                  </li>
                  <li>
                    Keep your laptop connected to a <span className="font-medium text-foreground">stable internet
                    connection that will not drop</span> (and plugged in to power) for the whole interview.
                  </li>
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="mt-4">
            <CardContent className="space-y-3 p-4 sm:p-6">
              <h3 className="font-semibold">Integrity Notices</h3>
              {antiCheatingEnabled ? (
                <>
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    To ensure fairness, the following integrity measures will be
                    actively enforced throughout this session.
                  </div>
                  <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                    <li>
                      To ensure that the interview runs properly, please use the
                      latest version of Chrome.
                    </li>
                    <li>
                      After completing your answers, please make sure that you have
                      submitted them to all questions. Otherwise it will affect your
                      results.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Tab switching and focus tracking:</span>{" "}
                      Leaving the interview page or switching to another window will
                      be automatically detected and recorded. If you leave more
                      than{" "}
                      <span className="font-medium text-primary">3</span> times,
                      your session will be flagged for review.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">External paste blocked:</span>{" "}
                      Pasting content from outside the interview page is not
                      allowed. You can copy and paste freely within the page.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Multiple screen detection:</span>{" "}
                      The system will detect if you have multiple monitors connected.
                      Please unplug or turn off additional screens before starting.
                    </li>
                    <li>
                      This interview requires a camera to collect your registration
                      photo and capture your behavior. All photos are privacy
                      protected.
                    </li>
                    <li>
                      The interview will screen capture throughout. Screen capture
                      requires authorization.
                    </li>
                  </ol>
                </>
              ) : (
                <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                  <li>
                    To ensure that the interview runs properly, please use the
                    latest version of Chrome.
                  </li>
                  <li>
                    After completing your answers, please make sure that you have
                    submitted them to all questions. Otherwise it will affect your
                    results.
                  </li>
                  <li>
                    Before the interview starts, please shut down any software or
                    web page with ads, message pop-ups. Please do not leave the
                    interview page during the whole process.
                  </li>
                  <li>
                    This interview requires a camera to collect your registration
                    photo and capture your behavior. All photos are privacy
                    protected.
                  </li>
                  <li>
                    The interview will screen capture throughout. Screen capture
                    requires authorization.
                  </li>
                </ol>
              )}
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col items-center gap-3 border-t bg-muted/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:gap-4 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
              />
              {oneTimeLink
                ? "I understand this link works only once, and I agree to the above notices and guidelines"
                : "I agree to the above notice and interview guidelines"}
            </label>
            <Button
              disabled={!agreed}
              onClick={() => setStep("checklist")}
              className="h-11 w-40 sm:h-10"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (starting) {
    return <PreparingScreen />;
  }

  if (step === "howItWorks") {
    const mode = voiceEnabled ? "voice" : "chat";

    const mockContext: InterviewContext = {
      title: interviewTitle,
      aiName: aiName ?? "ResilienceSoft Interview",
      aiTone: "professional",
      language: language ?? "en-US",
      followUpDepth: "medium",
      questions: Array.from({ length: questionCount }, (_, i) => ({
        text: `Question ${i + 1}`,
        type: questionTypes?.[i] ?? "OPEN_ENDED",
        order: i,
      })),
    };

    return (
      <IntervieweeTourProvider mode={mode}>
        <PreviewWrapper onReady={handleComplete}>
          {mode === "voice" ? (
            <VoiceInterface
              sessionId="__preview__"
              interviewId="__preview__"
              interviewTitle={interviewTitle}
              aiName={aiName ?? "ResilienceSoft Interview"}
              questionCount={questionCount}
              interviewContext={mockContext}
              durationMinutes={timeLimitMinutes ?? undefined}
              chatEnabled={chatEnabled}
              onComplete={() => {}}
              preview
            />
          ) : (
            <ChatInterface
              sessionId="__preview__"
              interview={{
                id: "__preview__",
                title: interviewTitle,
                aiName: aiName ?? "ResilienceSoft Interview",
                mode: "CHAT",
                questions: mockContext.questions.map((q, i) => ({
                  id: `preview-q-${i}`,
                  text: q.text,
                  type: q.type,
                })),
              }}
              durationMinutes={timeLimitMinutes ?? undefined}
              onComplete={() => {}}
              preview
            />
          )}
        </PreviewWrapper>
        <IntervieweeTourOverlay />
      </IntervieweeTourProvider>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      {header}
      <StepIndicator current="checklist" />
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 pb-8">
        <CameraCheck done={cameraDone} onDone={() => setCameraDone(true)} allowSkip={!antiCheatingEnabled} />
        <MicCheck done={micDone} onDone={() => setMicDone(true)} language={language} allowSkip={!antiCheatingEnabled} sessionId={sessionId} />
        <ScreenCheck done={screenDone} onDone={() => setScreenDone(true)} allowSkip={!antiCheatingEnabled} />

        <div className="sticky bottom-0 -mx-4 flex items-center justify-center gap-3 border-t bg-muted/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-4 sm:backdrop-blur-none">
          <Button variant="outline" onClick={() => setStep("info")}>
            Back
          </Button>
          <Button disabled={!allChecksDone} onClick={() => setStep("howItWorks")}>
            Next
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Chrome is recommended for a better experience.
        </p>
      </div>
    </div>
  );
}
