/**
 * Candidate-only mic audio helpers (pure, no I/O).
 *
 * The mic track has only the candidate's voice, so it is cut into answer-sized
 * clips at pauses. Each clip is transcribed on its own, and knows exactly when
 * it was spoken (runStartMs + startSec), which places it under the right
 * question. Short clips also keep every speech engine inside its length limit.
 */

export type WavAudio = { sampleRate: number; pcm: Int16Array };

/** Parse 16-bit PCM mono/stereo WAV (as written by ffmpeg); stereo is averaged to mono. */
export function parseWav(buf: Buffer): WavAudio {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let pos = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bits = 16;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error("Only 16-bit WAV is supported");
      // ffmpeg writing to a pipe leaves the size as 0 / 0xFFFFFFFF: take the rest of the file.
      if (size === 0 || body + size > buf.length) size = buf.length - body;
      const frames = Math.floor(size / (2 * channels));
      const pcm = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(body + (i * channels + c) * 2);
        pcm[i] = Math.round(sum / channels);
      }
      return { sampleRate, pcm };
    }
    pos = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** 16-bit mono PCM → WAV file bytes. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataBytes = pcm.length * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i], 44 + i * 2);
  return out;
}

export type SpeechSegment = { startSec: number; endSec: number };

export type SplitOptions = {
  frameMs?: number;
  /** Pauses shorter than this stay inside one answer. */
  mergeGapMs?: number;
  /** Bursts shorter than this are clicks / breaths. */
  minSpeechMs?: number;
  padMs?: number;
  /** Longest clip; longer speech is cut at its quietest point near the limit. */
  maxSegmentSec?: number;
  /** Speech must be this far (dB) above the noise floor. */
  marginDb?: number;
  /** ...and never below this absolute level (dBFS). */
  minThresholdDb?: number;
};

const DEFAULTS: Required<SplitOptions> = {
  frameMs: 20,
  mergeGapMs: 1000,
  minSpeechMs: 350,
  padMs: 250,
  maxSegmentSec: 50,
  marginDb: 12,
  minThresholdDb: -48,
};

/** Cut mono PCM into speech segments at pauses. Returns [] for silence. */
export function splitSpeechSegments(pcm: Int16Array, sampleRate: number, options: SplitOptions = {}): SpeechSegment[] {
  const o = { ...DEFAULTS, ...options };
  const frameLen = Math.max(1, Math.round((sampleRate * o.frameMs) / 1000));
  const frames = Math.floor(pcm.length / frameLen);
  if (frames < 2) return [];

  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const v = pcm[base + i] / 32768;
      sum += v * v;
    }
    db[f] = 10 * Math.log10(sum / frameLen + 1e-10);
  }

  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.98)];
  if (loud < -55) return []; // nothing but silence / hiss
  // Steady loud audio has no quiet floor to measure against: stay below its own peak level.
  const threshold = Math.max(Math.min(floor + o.marginDb, loud - 10), o.minThresholdDb);

  const mergeFrames = Math.ceil(o.mergeGapMs / o.frameMs);
  const minFrames = Math.ceil(o.minSpeechMs / o.frameMs);
  const padFrames = Math.ceil(o.padMs / o.frameMs);
  const maxFrames = Math.floor((o.maxSegmentSec * 1000) / o.frameMs);

  // Speech runs, merging short pauses.
  const runs: [number, number][] = [];
  let start = -1;
  let lastSpeech = -1;
  for (let f = 0; f < frames; f++) {
    if (db[f] > threshold) {
      if (start < 0) start = f;
      else if (f - lastSpeech > mergeFrames) {
        runs.push([start, lastSpeech]);
        start = f;
      }
      lastSpeech = f;
    }
  }
  if (start >= 0) runs.push([start, lastSpeech]);

  const out: SpeechSegment[] = [];
  for (const [rs, re] of runs) {
    if (re - rs + 1 < minFrames) continue;
    let a = Math.max(0, rs - padFrames);
    const end = Math.min(frames - 1, re + padFrames);
    while (end - a + 1 > maxFrames) {
      // Cut at the quietest frame in the last 12 s before the limit.
      const lo = a + Math.max(1, maxFrames - Math.floor(12_000 / o.frameMs));
      const hi = a + maxFrames;
      let cut = hi;
      let best = Infinity;
      for (let f = lo; f <= hi && f < end; f++) {
        if (db[f] < best) {
          best = db[f];
          cut = f;
        }
      }
      out.push({ startSec: (a * frameLen) / sampleRate, endSec: ((cut + 1) * frameLen) / sampleRate });
      a = cut + 1;
    }
    out.push({ startSec: (a * frameLen) / sampleRate, endSec: ((end + 1) * frameLen) / sampleRate });
  }
  return out;
}

export function sliceWav(audio: WavAudio, seg: SpeechSegment): Buffer {
  const a = Math.max(0, Math.floor(seg.startSec * audio.sampleRate));
  const b = Math.min(audio.pcm.length, Math.ceil(seg.endSec * audio.sampleRate));
  return encodeWav(audio.pcm.subarray(a, b), audio.sampleRate);
}
