import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMicTrackRecorder } from "@/lib/mic-track-recorder";
import {
  R2_RECORDING_PARTICIPANT,
  R2_UPLOAD_GRACE_MS,
  buildR2TranscriptRows,
  groupR2Parts,
  isR2AudioTrack,
  isRecordingRow,
  parseR2PartKey,
  parseR2SnapshotKey,
  r2MediaFolder,
  r2PartFileName,
  r2RecordingFileName,
  r2SnapshotFileName,
  roundAcceptsMedia,
  shouldUseRecordingTranscript,
} from "@/lib/round-two/recording";
import { contiguousMicParts, isRunComplete } from "@/lib/recording-parts";
import { selectSttCandidates } from "@/lib/transcript/stt-engines";
import type { ResolvedAiCredentials } from "@/lib/ai/credentials";

const ID = "3f2b8c1a-1111-4222-8333-944455556666";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DIR = "orgs/o1/projects/p1/candidates/Vyom_Sahu_ab12cd34/recordings/round2-" + ID;

describe("round 2 recording: part names", () => {
  it("round-trips a part file name", () => {
    const name = r2PartFileName({ track: "cand", roundTwoId: ID.toUpperCase(), runId: 1764230000123, seq: 7, elapsedSec: 70.4, ext: "webm" });
    assert.equal(name, `r2cand-${ID}-1764230000123-00007-70.webm`);
    const p = parseR2PartKey(`${DIR}/${name}`);
    assert.deepEqual(p, { key: `${DIR}/${name}`, track: "cand", sessionId: ID, runId: 1764230000123, seq: 7, elapsedSec: 70, ext: "webm" });
  });

  it("rejects other files (round 1 parts, path tricks, bad tracks)", () => {
    assert.equal(parseR2PartKey(`part-${ID}-1764230000123-00000-0.webm`), null);
    assert.equal(parseR2PartKey(`micpart-${ID}-1764230000123-00000-0.webm`), null);
    assert.equal(parseR2PartKey(`r2video-${ID}-1764230000123-00000-0.webm`), null);
    assert.equal(parseR2PartKey(`r2mix-${ID}-1764230000123-00000-0.exe`), null);
    assert.equal(isR2AudioTrack("mix"), true);
    assert.equal(isR2AudioTrack("video"), false);
  });

  it("groups one track's parts into runs, ordered, de-duplicated, other rounds ignored", () => {
    const k = (track: "mix" | "cand" | "panel", run: number, seq: number, id = ID) =>
      `${DIR}/${r2PartFileName({ track, roundTwoId: id, runId: run, seq, elapsedSec: seq * 10, ext: "webm" })}`;
    const keys = [k("mix", 2000000000000, 1), k("mix", 2000000000000, 0), k("mix", 2000000000000, 0), k("cand", 2000000000000, 0), k("mix", 1000000000000, 0), k("mix", 1000000000000, 2), k("mix", 3000000000000, 0, OTHER)];
    const runs = groupR2Parts(keys, ID, "mix");
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.runId), [1000000000000, 2000000000000]);
    assert.deepEqual(runs[1].parts.map((p) => p.seq), [0, 1]);
    assert.equal(isRunComplete(runs[1]), true);
    // A gap: only the parts before it are byte-continuous.
    assert.equal(isRunComplete(runs[0]), false);
    assert.deepEqual(contiguousMicParts(runs[0]).map((p) => p.seq), [0]);
    assert.equal(groupR2Parts(keys, ID, "cand").length, 1);
    assert.equal(groupR2Parts(keys, ID, "panel").length, 0);
  });

  it("snapshot + recording names and folders", () => {
    const snap = r2SnapshotFileName(ID, 1764230000999);
    assert.equal(snap, `r2snap-${ID}-1764230000999.jpg`);
    assert.deepEqual(parseR2SnapshotKey(`x/images/${snap}`, ID), { key: `x/images/${snap}`, at: 1764230000999 });
    assert.equal(parseR2SnapshotKey(`x/images/${snap}`, OTHER), null);
    assert.equal(parseR2SnapshotKey("x/images/2026-11-27T10-00-00-camera.jpg", ID), null);
    assert.equal(r2RecordingFileName(ID, "m4a"), `round2-recording-${ID}.m4a`);
    assert.equal(r2MediaFolder("orgs/o/projects/p/candidates/c/", ID, "images"), `orgs/o/projects/p/candidates/c/images/round2-${ID}`);
  });
});

describe("round 2 recording: upload window", () => {
  const now = Date.parse("2026-11-27T11:00:00Z");
  it("open while live and admitted, briefly after the end, never before admission", () => {
    assert.equal(roundAcceptsMedia({ status: "live", candidateAdmittedAt: "2026-11-27T10:00:00Z" }, now), true);
    assert.equal(roundAcceptsMedia({ status: "live", candidateAdmittedAt: null }, now), false);
    assert.equal(roundAcceptsMedia({ status: "scheduled", candidateAdmittedAt: "2026-11-27T10:00:00Z" }, now), false);
    assert.equal(roundAcceptsMedia({ status: "ended", candidateAdmittedAt: "x", endedAt: new Date(now - 60_000).toISOString() }, now), true);
    assert.equal(roundAcceptsMedia({ status: "ended", candidateAdmittedAt: "x", endedAt: new Date(now - R2_UPLOAD_GRACE_MS - 1).toISOString() }, now), false);
    assert.equal(roundAcceptsMedia({ status: "cancelled", candidateAdmittedAt: "x", endedAt: new Date(now).toISOString() }, now), false);
  });
});

describe("round 2 recording: transcript rows", () => {
  const t0 = 1_764_230_000_000;
  it("interleaves candidate and interviewer lines by time, relative to the round start", () => {
    const rows = buildR2TranscriptRows(
      [{ startMs: t0 + 12_000, endMs: t0 + 20_000, text: " Mera naam Vyom hai, main HR mein kaam karta hoon. " }],
      [
        { startMs: t0 + 2_000, endMs: t0 + 8_000, text: "Please introduce yourself." },
        { startMs: t0 + 25_000, endMs: t0 + 30_000, text: "Thanks. Tell me about social media campaigns." },
      ],
      t0,
    );
    assert.deepEqual(
      rows.map((r) => [r.speakerRole, r.startMs, r.participantId, r.speakerName]),
      [
        ["interviewer", 2000, R2_RECORDING_PARTICIPANT.interviewer, "Interviewer"],
        ["candidate", 12000, R2_RECORDING_PARTICIPANT.candidate, "Candidate"],
        ["interviewer", 25000, R2_RECORDING_PARTICIPANT.interviewer, "Interviewer"],
      ],
    );
    assert.equal(rows[1].text, "Mera naam Vyom hai, main HR mein kaam karta hoon.");
    assert.ok(rows.every((r) => isRecordingRow(r.participantId)));
    assert.equal(isRecordingRow("cand:abc"), false);
  });

  it("drops interviewer speech picked up by the candidate's mic (no headphones)", () => {
    const rows = buildR2TranscriptRows(
      [
        { startMs: t0 + 2_200, endMs: t0 + 8_100, text: "please introduce yourself" },
        { startMs: t0 + 9_000, endMs: t0 + 15_000, text: "Sure, I have two years of experience in recruitment." },
      ],
      [{ startMs: t0 + 2_000, endMs: t0 + 8_000, text: "Please introduce yourself." }],
      t0,
    );
    assert.deepEqual(rows.map((r) => r.speakerRole), ["interviewer", "candidate"]);
    assert.match(rows[1].text, /two years/);
  });

  it("keeps the candidate's own words even when they overlap a different interviewer line", () => {
    const rows = buildR2TranscriptRows(
      [{ startMs: t0 + 1_000, endMs: t0 + 5_000, text: "Yes I can hear you clearly" }],
      [{ startMs: t0 + 1_000, endMs: t0 + 4_000, text: "Can you hear me?" }],
      t0,
    );
    assert.equal(rows.filter((r) => r.speakerRole === "candidate").length, 1);
  });

  it("decides when the recording transcript replaces the live one", () => {
    const live = ["I worked on recruitment drives and onboarding for two years at my last company"];
    assert.equal(shouldUseRecordingTranscript({ liveCandidateTexts: [], recordingCandidateTexts: ["hello"], clipsTotal: 10, clipsMissed: 8 }).use, true);
    assert.equal(shouldUseRecordingTranscript({ liveCandidateTexts: live, recordingCandidateTexts: [], clipsTotal: 0, clipsMissed: 0 }).use, false);
    assert.equal(shouldUseRecordingTranscript({ liveCandidateTexts: live, recordingCandidateTexts: ["recruitment drives"], clipsTotal: 4, clipsMissed: 0 }).use, false);
    assert.equal(shouldUseRecordingTranscript({ liveCandidateTexts: live, recordingCandidateTexts: live, clipsTotal: 10, clipsMissed: 4 }).use, false);
    assert.equal(shouldUseRecordingTranscript({ liveCandidateTexts: live, recordingCandidateTexts: [...live, "and more"], clipsTotal: 10, clipsMissed: 1 }).use, true);
  });
});

describe("round 2 recording: engines follow the org's keys", () => {
  const creds = (keys: Partial<Record<string, string[]>>) =>
    Object.fromEntries(
      Object.entries(keys).map(([id, apiKeys]) => [id, { apiKeys, from: "org" }]),
    ) as unknown as ResolvedAiCredentials;
  it("Gemini key → Gemini first; OpenAI / Groq their own; Anthropic alone → none", () => {
    assert.deepEqual(selectSttCandidates({ merged: creds({ gemini: ["g"] }), routing: {} }).map((c) => c.engine), ["gemini"]);
    assert.deepEqual(selectSttCandidates({ merged: creds({ openai: ["o"], groq: ["q"] }), routing: {} }).map((c) => c.engine), ["openai", "groq"]);
    assert.deepEqual(selectSttCandidates({ merged: creds({ anthropic: ["a"] }), routing: {} }), []);
    assert.deepEqual(selectSttCandidates({ merged: creds({ anthropic: ["a"], groq: ["q"] }), routing: {} }).map((c) => c.engine), ["groq"]);
  });
});

describe("round 2 recording: browser part recorder", () => {
  it("posts round 2 parts to the round 2 route with the round 2 fields (round 1 default unchanged)", async () => {
    type Rec = { ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void; state: string };
    const made: Rec[] = [];
    class FakeRecorder {
      state = "inactive";
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      onerror?: () => void;
      static isTypeSupported = (m: string) => m === "audio/webm;codecs=opus";
      constructor() {
        made.push(this);
      }
      start() {
        this.state = "recording";
      }
      requestData() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["last"], { type: "audio/webm" }) });
        this.state = "inactive";
        this.onstop?.();
      }
    }
    class FakeStream {
      constructor(private tracks: unknown[] = [{}]) {}
      getAudioTracks() {
        return this.tracks;
      }
    }
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { MediaRecorder: g.MediaRecorder, MediaStream: g.MediaStream, fetch: g.fetch };
    const calls: { url: string; fields: Record<string, string> }[] = [];
    g.MediaRecorder = FakeRecorder;
    g.MediaStream = FakeStream;
    g.fetch = async (url: string, init: { body: FormData }) => {
      const fields: Record<string, string> = {};
      init.body.forEach((v, k) => {
        if (typeof v === "string") fields[k] = v;
      });
      calls.push({ url, fields });
      return new Response("{}", { status: 200 });
    };
    try {
      const r2 = createMicTrackRecorder("", { url: "/api/round-two/candidate/media", fields: { token: "tok-1234567890", type: "audio_part", track: "cand" } });
      r2.start(new FakeStream() as unknown as MediaStream);
      made[0].ondataavailable?.({ data: new Blob(["a"], { type: "audio/webm" }) });
      await r2.stop(2000);
      assert.ok(calls.length >= 1);
      assert.equal(calls[0].url, "/api/round-two/candidate/media");
      assert.equal(calls[0].fields.track, "cand");
      assert.equal(calls[0].fields.token, "tok-1234567890");
      assert.equal(calls[0].fields.type, "audio_part");
      assert.equal(calls[0].fields.seq, "0");
      assert.equal(calls[0].fields.sessionId, undefined);

      calls.length = 0;
      const r1 = createMicTrackRecorder("sess-1");
      r1.start(new FakeStream() as unknown as MediaStream);
      await r1.stop(2000);
      assert.equal(calls[0].url, "/api/session/upload");
      assert.equal(calls[0].fields.type, "mic_part");
      assert.equal(calls[0].fields.sessionId, "sess-1");
    } finally {
      Object.assign(g, saved);
    }
  });
});

describe("round 2 recording: wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the report saves the recording and rebuilds the transcript before reading it", () => {
    const src = read("src/server/round-two/report.ts");
    assert.match(src, /addEdge\(START, "media"\)/);
    assert.match(src, /addEdge\("media", "gather"\)/);
  });
  it("the candidate page records after admission and tells the candidate first", () => {
    const src = read("src/app/r2/c/[token]/page.tsx");
    assert.match(src, /useRoundTwoCandidateCapture\(linkToken, admitted\)/);
    assert.match(src, /audio is recorded and transcribed/);
    assert.match(src, /photos are taken from my camera/);
  });
  it("a Gemini-only org still gets a live transcript", () => {
    assert.match(read("src/server/round-two/stt.ts"), /provider: "gemini"/);
    assert.match(read("server/round-two-agent.ts"), /if \(t\.provider === "gemini"\) return transcribeWithGemini/);
  });
});

describe("round 2 recording: parts → audio → transcript rows (ffmpeg)", () => {
  it("joins byte-sliced webm parts, cuts speech, labels candidate vs interviewer", async (t) => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync: rf, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { decodeToWav, ffmpegAvailable } = await import("@/lib/transcript/mic-runs-server");
    const { transcribeAudioClips } = await import("@/lib/transcript/stt-pipeline");
    if (!ffmpegAvailable()) return t.skip("ffmpeg not installed");
    const dir = mkdtempSync(path.join(os.tmpdir(), "r2rec-"));
    try {
      // Two "utterances" (tones) separated by silence, Opus in WebM like MediaRecorder.
      const make = (name: string, a: number, b: number) => {
        const f = path.join(dir, name);
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
          `aevalsrc='if(between(t,${a},${a + 2})+between(t,${b},${b + 2}),0.5*sin(2*PI*220*t),0)':s=48000:d=12`,
          "-c:a", "libopus", "-b:a", "32k", f]);
        return rf(f);
      };
      const cand = make("cand.webm", 4, 9);
      const panel = make("panel.webm", 1, 6.5);
      const run = 1_764_230_000_000;
      // MediaRecorder slices: byte-continuous chunks of one file.
      const slice = (buf: Buffer) => [buf.subarray(0, Math.floor(buf.length / 3)), buf.subarray(Math.floor(buf.length / 3), Math.floor((2 * buf.length) / 3)), buf.subarray(Math.floor((2 * buf.length) / 3))];
      const store = new Map<string, Buffer>();
      for (const [track, buf] of [["cand", cand], ["panel", panel]] as const) {
        slice(buf).forEach((b, seq) => store.set(`${DIR}/${r2PartFileName({ track, roundTwoId: ID, runId: run, seq, elapsedSec: seq * 4, ext: "webm" })}`, b));
      }
      const keys = [...store.keys()];
      const fake = {
        gemini: { id: "gemini" as const, label: "fake", transcribeClip: async (_c: unknown, req: { audio: Buffer }) => ({ text: `clip of ${req.audio.length} bytes`, model: "fake" }) },
      };
      const clipsFor = async (track: "cand" | "panel") => {
        const out: { startMs: number; endMs: number; text: string }[] = [];
        for (const r of groupR2Parts(keys, ID, track)) {
          const audio = await decodeToWav(Buffer.concat(contiguousMicParts(r).map((p) => store.get(p.key)!)), r.ext);
          const res = await transcribeAudioClips(
            audio,
            { candidates: [{ engine: "gemini", apiKey: "k", label: "fake" }], languages: { bcp47: ["en-IN"], iso: ["en"], hindi: false }, vocabulary: [], promptHint: "" },
            { engines: fake as never },
          );
          for (const c of res.clips) out.push({ text: c.text, startMs: r.runId + c.startSec * 1000, endMs: r.runId + c.endSec * 1000 });
        }
        return out;
      };
      const rows = buildR2TranscriptRows(await clipsFor("cand"), await clipsFor("panel"), run);
      assert.ok(rows.length >= 2, `rows: ${JSON.stringify(rows)}`);
      assert.ok(rows.some((r) => r.speakerRole === "candidate"));
      assert.ok(rows.some((r) => r.speakerRole === "interviewer"));
      // Interviewer spoke first (t≈1 s), the candidate answered at t≈4 s.
      assert.equal(rows[0].speakerRole, "interviewer");
      const firstCand = rows.find((r) => r.speakerRole === "candidate")!;
      assert.ok(firstCand.startMs >= 3000 && firstCand.startMs <= 5000, `candidate start ${firstCand.startMs}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
