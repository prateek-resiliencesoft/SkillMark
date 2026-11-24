/**
 * Round 2 transcription agent.
 *
 * Joins every live round-two LiveKit room as a hidden subscriber, segments each
 * participant's audio into utterances (energy VAD), transcribes them with an
 * OpenAI-compatible /audio/transcriptions endpoint and posts final segments to
 * the app, which stores them, fans them out to the panel and drives the copilot.
 *
 * Env: ROUND2_APP_URL, ROUND2_AGENT_SECRET, LIVEKIT_AGENT_URL | LIVEKIT_URL,
 *      ROUND2_STT_API_KEY | OPENAI_API_KEY, ROUND2_STT_BASE_URL, ROUND2_STT_MODEL
 */
import { AudioStream, Room, RoomEvent, TrackKind, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";

const APP_URL = (process.env.ROUND2_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.ROUND2_AGENT_SECRET || "";
const LIVEKIT_URL = process.env.LIVEKIT_AGENT_URL || process.env.LIVEKIT_URL || "";
const STT_KEY = process.env.ROUND2_STT_API_KEY || process.env.OPENAI_API_KEY || "";
const STT_BASE = (process.env.ROUND2_STT_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const STT_MODEL = process.env.ROUND2_STT_MODEL || "gpt-4o-mini-transcribe";
const POLL_MS = 5_000;

const SAMPLE_RATE = 16_000;
const SPEECH_RMS = Number(process.env.ROUND2_VAD_RMS || 600);
const END_SILENCE_MS = 700;
const MAX_UTTERANCE_MS = 15_000;
const MIN_SPEECH_MS = 350;
const PREROLL_MS = 200;

type LiveRoom = { roundTwoId: string; room: string; token: string };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[round2-agent]", ...a);

const authHeaders = { Authorization: `Bearer ${SECRET}` };

function wav(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

async function transcribe(pcm: Int16Array): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav(pcm, SAMPLE_RATE))], { type: "audio/wav" }), "utterance.wav");
  form.append("model", STT_MODEL);
  form.append("response_format", "json");
  const res = await fetch(`${STT_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STT_KEY}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

async function postSegment(seg: { roundTwoId: string; identity: string; name: string; text: string; startedAt: number; endedAt: number }) {
  const res = await fetch(`${APP_URL}/api/round-two/agent/transcript`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(seg),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) log("transcript post failed", res.status, await res.text().catch(() => ""));
}

/** Reads one audio track, cuts utterances on silence and transcribes them in order. */
async function consumeTrack(roundTwoId: string, track: RemoteTrack, participant: RemoteParticipant, signal: AbortSignal) {
  const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 });
  const reader = stream.getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });

  let chain: Promise<void> = Promise.resolve();
  const preroll: Int16Array[] = [];
  let prerollMs = 0;
  let chunks: Int16Array[] = [];
  let speechMs = 0;
  let totalMs = 0;
  let silenceMs = 0;
  let startedAt = 0;
  let speaking = false;

  const flush = () => {
    if (!speaking) return;
    const parts = chunks;
    const spoke = speechMs;
    const start = startedAt;
    const end = Date.now() - silenceMs;
    speaking = false;
    chunks = [];
    speechMs = totalMs = silenceMs = 0;
    if (spoke < MIN_SPEECH_MS) return;
    const len = parts.reduce((n, p) => n + p.length, 0);
    const pcm = new Int16Array(len);
    let off = 0;
    for (const p of parts) {
      pcm.set(p, off);
      off += p.length;
    }
    chain = chain.then(async () => {
      try {
        const text = await transcribe(pcm);
        if (!text) return;
        await postSegment({ roundTwoId, identity: participant.identity, name: participant.name || participant.identity, text, startedAt: start, endedAt: end });
      } catch (e) {
        log("stt error", participant.identity, e instanceof Error ? e.message : e);
      }
    });
  };

  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      const samples = new Int16Array(frame.data);
      const ms = (frame.samplesPerChannel / frame.sampleRate) * 1000;
      const loud = rms(samples) >= SPEECH_RMS;

      if (!speaking) {
        preroll.push(samples);
        prerollMs += ms;
        while (prerollMs > PREROLL_MS && preroll.length > 1) prerollMs -= (preroll.shift()!.length / SAMPLE_RATE) * 1000;
        if (loud) {
          speaking = true;
          startedAt = Date.now() - prerollMs;
          chunks = preroll.splice(0);
          totalMs = prerollMs;
          prerollMs = 0;
          speechMs = ms;
          silenceMs = 0;
        }
        continue;
      }

      chunks.push(samples);
      totalMs += ms;
      if (loud) {
        speechMs += ms;
        silenceMs = 0;
      } else {
        silenceMs += ms;
      }
      if (silenceMs >= END_SILENCE_MS || totalMs >= MAX_UTTERANCE_MS) flush();
    }
  } catch (e) {
    if (!signal.aborted) log("audio stream error", participant.identity, e instanceof Error ? e.message : e);
  } finally {
    flush();
    await chain;
  }
}

class RoomWorker {
  private room = new Room();
  private tracks = new Map<string, AbortController>();

  constructor(private readonly live: LiveRoom) {}

  async start() {
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO || participant.identity.startsWith("agent:")) return;
      const sid = publication.sid ?? `${participant.identity}:${Date.now()}`;
      const ctrl = new AbortController();
      this.tracks.set(sid, ctrl);
      log("transcribing", this.live.room, participant.identity);
      void consumeTrack(this.live.roundTwoId, track, participant, ctrl.signal).finally(() => this.tracks.delete(sid));
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
      const sid = publication.sid;
      if (sid) this.tracks.get(sid)?.abort();
    });
    this.room.on(RoomEvent.Disconnected, () => {
      log("disconnected", this.live.room);
      workers.delete(this.live.roundTwoId);
      this.abortAll();
    });
    await this.room.connect(LIVEKIT_URL, this.live.token, { autoSubscribe: true, dynacast: false });
    log("joined", this.live.room);
  }

  private abortAll() {
    for (const c of this.tracks.values()) c.abort();
    this.tracks.clear();
  }

  async stop() {
    this.abortAll();
    await this.room.disconnect().catch(() => {});
  }
}

const workers = new Map<string, RoomWorker>();
const joining = new Set<string>();

async function poll() {
  let rooms: LiveRoom[];
  try {
    const res = await fetch(`${APP_URL}/api/round-two/agent/rooms`, { headers: authHeaders, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      log("rooms poll failed", res.status);
      return;
    }
    rooms = ((await res.json()) as { rooms: LiveRoom[] }).rooms ?? [];
  } catch (e) {
    log("rooms poll error", e instanceof Error ? e.message : e);
    return;
  }

  const liveIds = new Set(rooms.map((r) => r.roundTwoId));
  for (const [id, w] of workers) {
    if (!liveIds.has(id)) {
      workers.delete(id);
      log("leaving", id);
      void w.stop();
    }
  }
  for (const r of rooms) {
    if (workers.has(r.roundTwoId) || joining.has(r.roundTwoId)) continue;
    joining.add(r.roundTwoId);
    const w = new RoomWorker(r);
    workers.set(r.roundTwoId, w);
    w.start()
      .catch((e) => {
        workers.delete(r.roundTwoId);
        log("join failed", r.room, e instanceof Error ? e.message : e);
      })
      .finally(() => joining.delete(r.roundTwoId));
  }
}

async function main() {
  if (!SECRET || SECRET.length < 16) throw new Error("ROUND2_AGENT_SECRET (16+ chars) is required");
  if (!LIVEKIT_URL) throw new Error("LIVEKIT_AGENT_URL or LIVEKIT_URL is required");
  if (!STT_KEY) throw new Error("ROUND2_STT_API_KEY or OPENAI_API_KEY is required");
  log(`polling ${APP_URL} · livekit ${LIVEKIT_URL} · stt ${STT_BASE} (${STT_MODEL})`);
  await poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  const shutdown = async () => {
    clearInterval(timer);
    await Promise.all([...workers.values()].map((w) => w.stop()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((e) => {
  console.error("[round2-agent] fatal", e);
  process.exit(1);
});
