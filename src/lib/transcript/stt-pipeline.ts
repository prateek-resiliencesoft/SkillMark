/**
 * Decoded audio → text clips with times. Pure apart from the engines' network calls.
 * Used for the candidate-only mic track and, when the best engine isn't Gemini, the mixed recording.
 */
import { sliceWav, splitSpeechSegments, type WavAudio } from "./mic-audio";
import {
  transcribeClips,
  type SttCandidate,
  type SttDeps,
  type SttEngine,
  type SttEngineId,
  type SttLanguages,
} from "./stt-engines";

export type PipelineContext = {
  candidates: SttCandidate[];
  languages: SttLanguages;
  vocabulary: string[];
  promptHint: string;
};

export type TimedClip = { startSec: number; endSec: number; text: string };

export type PipelineResult = {
  clips: TimedClip[];
  usage: Record<string, number>;
  failures: string[];
  /** Speech segments found / clips no engine could transcribe. */
  segments: number;
  unTranscribed: number;
};

/** A 4 h recording would be ~hundreds of answers; never queue more than this many paid calls for one run. */
export const MAX_CLIPS_PER_RUN = 400;

export async function transcribeAudioClips(
  audio: WavAudio,
  ctx: PipelineContext,
  deps?: SttDeps & { concurrency?: number; engines?: Record<SttEngineId, SttEngine> },
): Promise<PipelineResult> {
  const segments = splitSpeechSegments(audio.pcm, audio.sampleRate).slice(0, MAX_CLIPS_PER_RUN);
  if (!segments.length) return { clips: [], usage: {}, failures: [], segments: 0, unTranscribed: 0 };
  const run = await transcribeClips(
    ctx.candidates,
    segments.map((s) => ({ audio: sliceWav(audio, s), mime: "audio/wav" })),
    { languages: ctx.languages, vocabulary: ctx.vocabulary, promptHint: ctx.promptHint },
    deps,
  );
  const clips: TimedClip[] = [];
  let unTranscribed = 0;
  run.results.forEach((r, i) => {
    if (!r) unTranscribed++;
    else if (r.text.trim()) clips.push({ startSec: segments[i].startSec, endSec: segments[i].endSec, text: r.text.trim() });
  });
  return { clips, usage: run.usage, failures: run.failures, segments: segments.length, unTranscribed };
}
