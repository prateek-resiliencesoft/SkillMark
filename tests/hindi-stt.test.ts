import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResolvedAiCredentials } from "@/lib/ai/credentials";
import { diarizeByLines, micClipsToTurns, alignCandidateTurns } from "@/lib/transcript/align";
import { applyCleanupGuard, cleanupTranscript, isSafeEdit } from "@/lib/transcript/cleanup";
import { encodeWav, parseWav, sliceWav, splitSpeechSegments } from "@/lib/transcript/mic-audio";
import { contiguousMicParts, groupMicParts, micPartFileName, parseMicPartKey, groupRecordingParts } from "@/lib/recording-parts";
import {
  describeNoSttReason,
  geminiInteractionText,
  GEMINI_TRANSCRIBE_MODEL,
  selectSttCandidates,
  STT_ENGINES,
  SttHttpError,
  sttLanguagesFor,
  transcribeClips,
  type SttCandidate,
  type SttEngine,
  type SttEngineId,
} from "@/lib/transcript/stt-engines";
import { transcribeAudioClips } from "@/lib/transcript/stt-pipeline";
import { buildPromptHint, buildVocabulary, extractTerms } from "@/lib/transcript/stt-vocab";

const SID = "be0a0182-f321-4110-8fc2-2a7d65a9dd97";
const dir = "orgs/o/projects/p/candidates/c/recordings/";

function creds(keys: Partial<Record<keyof ResolvedAiCredentials, string[]>>, extra: Partial<Record<keyof ResolvedAiCredentials, object>> = {}): ResolvedAiCredentials {
  const ids = ["openai", "gemini", "nvidia", "anthropic", "groq", "custom"] as const;
  const out = {} as ResolvedAiCredentials;
  for (const id of ids) {
    const k = keys[id] ?? [];
    out[id] = { apiKeys: k, from: k.length ? "org" : "none", ...(extra[id] ?? {}) };
  }
  return out;
}

// ── Mic part naming / grouping ──────────────────────────────────────────────

describe("mic track parts", () => {
  it("names round-trip and stay out of the mixed-recording grouping", () => {
    const name = micPartFileName({ sessionId: SID, runId: 1794549145000, seq: 2, elapsedSec: 20.4, ext: "webm" });
    assert.equal(name, `micpart-${SID}-1794549145000-00002-20.webm`);
    const p = parseMicPartKey(dir + name);
    assert.ok(p);
    assert.equal(p.runId, 1794549145000);
    assert.equal(p.seq, 2);
    assert.equal(groupRecordingParts([dir + name], SID).length, 0);
  });

  it("groups runs oldest first and stops at the first gap", () => {
    const mk = (runId: number, seq: number) => dir + micPartFileName({ sessionId: SID, runId, seq, elapsedSec: seq * 10, ext: "webm" });
    const keys = [mk(1_800_000_002_000, 0), mk(1_800_000_001_000, 1), mk(1_800_000_001_000, 0), mk(1_800_000_001_000, 3), dir + "recording-1.webm"];
    const runs = groupMicParts(keys, SID);
    assert.deepEqual(runs.map((r) => r.runId), [1_800_000_001_000, 1_800_000_002_000]);
    assert.deepEqual(contiguousMicParts(runs[0]).map((p) => p.seq), [0, 1]);
    assert.equal(groupMicParts(keys, "a4ecb928-b197-420f-80a7-a01c971add9e").length, 0);
  });
});

// ── Utterance splitting ─────────────────────────────────────────────────────

function synth(sampleRate: number, parts: { sec: number; amp: number }[]): Int16Array {
  const total = parts.reduce((n, p) => n + Math.round(p.sec * sampleRate), 0);
  const pcm = new Int16Array(total);
  let i = 0;
  let seed = 7;
  for (const p of parts) {
    const n = Math.round(p.sec * sampleRate);
    for (let k = 0; k < n; k++, i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed / 0x7fffffff - 0.5) * 2;
      pcm[i] = Math.round(p.amp * (0.6 * Math.sin((2 * Math.PI * 220 * k) / sampleRate) + 0.4 * noise) * 32767);
    }
  }
  return pcm;
}

describe("speech splitting", () => {
  const SR = 16000;
  it("cuts at pauses, merges short gaps, drops clicks", () => {
    const pcm = synth(SR, [
      { sec: 2, amp: 0.001 },
      { sec: 3, amp: 0.3 }, // answer 1
      { sec: 0.5, amp: 0.001 }, // short pause: same answer
      { sec: 2, amp: 0.3 },
      { sec: 3, amp: 0.001 }, // real pause
      { sec: 0.1, amp: 0.3 }, // click
      { sec: 3, amp: 0.001 },
      { sec: 4, amp: 0.3 }, // answer 2
      { sec: 2, amp: 0.001 },
    ]);
    const segs = splitSpeechSegments(pcm, SR);
    assert.equal(segs.length, 2);
    assert.ok(segs[0].startSec > 1.5 && segs[0].startSec < 2.1, `start ${segs[0].startSec}`);
    assert.ok(segs[0].endSec > 7.2 && segs[0].endSec < 7.9, `end ${segs[0].endSec}`);
    assert.ok(segs[1].startSec > 12.5);
  });

  it("returns nothing for silence", () => {
    assert.deepEqual(splitSpeechSegments(synth(SR, [{ sec: 10, amp: 0.0005 }]), SR), []);
  });

  it("force-splits very long speech into clips under the limit", () => {
    const pcm = synth(SR, [{ sec: 130, amp: 0.3 }]);
    const segs = splitSpeechSegments(pcm, SR, { maxSegmentSec: 50 });
    assert.ok(segs.length >= 3);
    for (const s of segs) assert.ok(s.endSec - s.startSec <= 50.1);
  });

  it("round-trips WAV and slices", () => {
    const pcm = synth(SR, [{ sec: 2, amp: 0.2 }]);
    const wav = encodeWav(pcm, SR);
    const back = parseWav(wav);
    assert.equal(back.sampleRate, SR);
    assert.equal(back.pcm.length, pcm.length);
    const slice = parseWav(sliceWav(back, { startSec: 0.5, endSec: 1.5 }));
    assert.equal(slice.pcm.length, SR);
  });
});

// ── Vocabulary ──────────────────────────────────────────────────────────────

describe("vocabulary", () => {
  it("puts names and interview terms first, then base terms, capped and clean", () => {
    const v = buildVocabulary({
      candidateName: "Dewashish Kumar",
      companyName: "FitPassio",
      texts: ["Tell me about your experience with Flutter and Firebase at Infosys.", "What is your current CTC?"],
      max: 100,
    });
    assert.equal(v[0], "Dewashish Kumar");
    assert.ok(v.includes("FitPassio"));
    assert.ok(v.includes("Flutter") && v.includes("Infosys"));
    assert.ok(v.includes("LPA"));
    assert.ok(v.length <= 100);
    assert.equal(new Set(v.map((x) => x.toLowerCase())).size, v.length);
    assert.ok(v.every((t) => !/[<>\n]/.test(t)));
    assert.equal(buildVocabulary({ max: 5, texts: [] }).length, 5);
  });

  it("extracts tech terms but not ordinary capitalised words", () => {
    const t = extractTerms("Tell me about Node.js and C++ in AWS. Then We discuss Kubernetes. Also React.");
    assert.ok(t.includes("Node.js") && t.includes("C++") && t.includes("AWS") && t.includes("Kubernetes") && t.includes("React"));
    assert.ok(!t.includes("Then") && !t.includes("Tell") && !t.includes("Also"));
  });

  it("builds a short Hinglish prompt hint", () => {
    const h = buildPromptHint(["Flutter"], { hindi: true });
    assert.match(h, /Hinglish/);
    assert.match(h, /Flutter/);
  });
});

// ── Engine selection from the org's keys ────────────────────────────────────

describe("engine selection", () => {
  const order = (c: SttCandidate[]) => c.map((x) => x.engine);

  it("Gemini key → gemini first; OpenAI / Groq follow", () => {
    const c = selectSttCandidates({ merged: creds({ gemini: ["g1"], openai: ["o1"], groq: ["q1"] }), routing: {} });
    assert.deepEqual(order(c), ["gemini", "openai", "groq"]);
  });

  it("OpenAI only → openai; Groq only → groq", () => {
    assert.deepEqual(order(selectSttCandidates({ merged: creds({ openai: ["o1"] }), routing: {} })), ["openai"]);
    assert.deepEqual(order(selectSttCandidates({ merged: creds({ groq: ["q1"] }), routing: {} })), ["groq"]);
  });

  it("Anthropic / NVIDIA keys cannot transcribe: skipped, then another STT key is used", () => {
    assert.deepEqual(selectSttCandidates({ merged: creds({ anthropic: ["a1"], nvidia: ["n1"] }), routing: {} }), []);
    assert.match(describeNoSttReason(creds({ anthropic: ["a1"] })), /anthropic/);
    assert.match(describeNoSttReason(creds({})), /No AI key/);
    const c = selectSttCandidates({ merged: creds({ anthropic: ["a1"], groq: ["q1"] }), routing: { report: ["anthropic", "groq"] } });
    assert.deepEqual(order(c), ["groq"]);
  });

  it("the org's own primary provider comes first when it can transcribe", () => {
    const merged = creds({ gemini: ["g1"], openai: ["o1"], groq: ["q1"] });
    assert.deepEqual(order(selectSttCandidates({ merged, routing: { report: ["openai", "gemini"] } })), ["openai", "gemini", "groq"]);
    assert.deepEqual(order(selectSttCandidates({ merged, routing: { round2_transcript: ["groq"], report: ["openai"] } })), ["groq", "openai", "gemini"]);
    // a primary that cannot transcribe is skipped, not an error
    assert.deepEqual(order(selectSttCandidates({ merged, routing: { report: ["anthropic", "openai"] } })), ["openai", "gemini", "groq"]);
  });

  it("every key of a provider is a candidate; tenant custom URLs are never used", () => {
    const c = selectSttCandidates({ merged: creds({ gemini: ["g1", "g2"] }), routing: {} });
    assert.equal(c.length, 2);
    assert.ok(c.every((x) => !x.label.includes("g1") && !x.label.includes("g2")));
    const tenant = creds({ custom: ["k"] }, { custom: { baseUrl: "https://evil.example/v1", untrustedBaseUrl: true } });
    assert.deepEqual(selectSttCandidates({ merged: tenant, routing: {} }), []);
    const platform = creds({ custom: ["k"] }, { custom: { baseUrl: "https://stt.internal/v1/" } });
    assert.deepEqual(order(selectSttCandidates({ merged: platform, routing: {} })), ["custom"]);
  });

  it("maps interview language to hints", () => {
    assert.deepEqual(sttLanguagesFor("hi").bcp47, ["hi-IN", "en-IN"]);
    assert.deepEqual(sttLanguagesFor("hi").iso, ["hi", "en"]);
    assert.equal(sttLanguagesFor("multi").hindi, true);
    assert.deepEqual(sttLanguagesFor("en").bcp47, ["en-IN"]);
    assert.equal(sttLanguagesFor("fr").single, "fr");
  });
});

// ── Engine requests (fake fetch) ────────────────────────────────────────────

type Call = { url: string; body: unknown; headers: Record<string, string> };
function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown }, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? Object.fromEntries(Array.from(init.body.keys()).map((k) => [k, (init.body as FormData).getAll(k).map((v) => (typeof v === "string" ? v : "<file>"))])) : init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.json ?? {}), { status });
  }) as typeof fetch;
}
const reqBase = {
  audio: Buffer.from("x"),
  mime: "audio/wav",
  languages: sttLanguagesFor("hi"),
  vocabulary: ["FitPassio", "LPA"],
  promptHint: "Hinglish. Names: FitPassio.",
};
const noSleep = async () => undefined;

describe("engine requests", () => {
  it("Gemini uses gemini-3.5-transcribe with hi-IN + en-IN and the vocabulary", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ json: { steps: [{ type: "model_output", content: [{ type: "text", text: "mera naam Dewashish hai" }] }] } }), calls);
    const out = await STT_ENGINES.gemini.transcribeClip({ engine: "gemini", apiKey: "k", label: "gemini/org#1" }, reqBase, { fetch: f, sleep: noSleep });
    assert.equal(out.model, GEMINI_TRANSCRIBE_MODEL);
    assert.equal(out.text, "mera naam Dewashish hai");
    assert.match(calls[0].url, /\/v1beta\/interactions$/);
    const b = calls[0].body as { model: string; generation_config: { transcription_config: { language_codes: string[]; custom_vocabulary: string[] } } };
    assert.equal(b.model, "gemini-3.5-transcribe");
    assert.deepEqual(b.generation_config.transcription_config.language_codes, ["hi-IN", "en-IN"]);
    assert.deepEqual(b.generation_config.transcription_config.custom_vocabulary, ["FitPassio", "LPA"]);
    assert.equal(calls[0].headers["x-goog-api-key"], "k");
  });

  it("Gemini falls back to the general model when 3.5 transcribe errors", async () => {
    const calls: Call[] = [];
    const f = fakeFetch((c) =>
      /interactions/.test(c.url)
        ? { status: 404, json: { error: "model not found" } }
        : { json: { candidates: [{ content: { parts: [{ text: "general path" }] } }] } },
    calls);
    const out = await STT_ENGINES.gemini.transcribeClip({ engine: "gemini", apiKey: "k", label: "x" }, reqBase, { fetch: f, sleep: noSleep });
    assert.equal(out.text, "general path");
    assert.notEqual(out.model, GEMINI_TRANSCRIBE_MODEL);
    assert.match(calls[1].url, /:generateContent$/);
  });

  it("Gemini does not retry other models on a bad key", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ status: 403, json: {} }), calls);
    await assert.rejects(STT_ENGINES.gemini.transcribeClip({ engine: "gemini", apiKey: "k", label: "x" }, reqBase, { fetch: f, sleep: noSleep }), (e: unknown) => e instanceof SttHttpError && e.status === 403);
    assert.equal(calls.length, 1);
  });

  it("OpenAI uses gpt-transcribe with languages[] and keywords[] (never `language`)", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ json: { text: "namaste" } }), calls);
    const out = await STT_ENGINES.openai.transcribeClip({ engine: "openai", apiKey: "k", label: "x" }, reqBase, { fetch: f, sleep: noSleep });
    assert.equal(out.model, "gpt-transcribe");
    const b = calls[0].body as Record<string, string[]>;
    assert.deepEqual(b["languages[]"], ["hi", "en"]);
    assert.deepEqual(b["keywords[]"], ["FitPassio", "LPA"]);
    assert.equal(b.language, undefined);
    assert.match(calls[0].url, /api\.openai\.com\/v1\/audio\/transcriptions$/);
  });

  it("OpenAI falls back to gpt-4o-transcribe with a single language", async () => {
    const calls: Call[] = [];
    const f = fakeFetch((c) => ((c.body as Record<string, string[]>).model[0] === "gpt-transcribe" ? { status: 400, json: {} } : { json: { text: "ok" } }), calls);
    const out = await STT_ENGINES.openai.transcribeClip({ engine: "openai", apiKey: "k", label: "x" }, reqBase, { fetch: f, sleep: noSleep });
    assert.equal(out.model, "gpt-4o-transcribe");
    assert.deepEqual((calls[1].body as Record<string, string[]>).language, ["hi"]);
    assert.equal((calls[1].body as Record<string, string[]>)["languages[]"], undefined);
  });

  it("Groq uses whisper-large-v3 with language=hi and a prompt", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ json: { text: "hello" } }), calls);
    const out = await STT_ENGINES.groq.transcribeClip({ engine: "groq", apiKey: "k", label: "x" }, reqBase, { fetch: f, sleep: noSleep });
    assert.equal(out.model, "whisper-large-v3");
    const b = calls[0].body as Record<string, string[]>;
    assert.deepEqual(b.language, ["hi"]);
    assert.deepEqual(b.prompt, [reqBase.promptHint]);
    assert.match(calls[0].url, /api\.groq\.com\/openai\/v1\/audio\/transcriptions$/);
  });

  it("parses Interactions API output shapes", () => {
    assert.equal(geminiInteractionText({ steps: [{ type: "user_input", content: [{ text: "no" }] }, { type: "model_output", content: [{ text: "a" }, { text: "b" }] }] }), "a b");
    assert.equal(geminiInteractionText({ outputs: [{ text: "legacy" }] }), "legacy");
    assert.equal(geminiInteractionText({}), "");
  });
});

// ── Fallback chain ──────────────────────────────────────────────────────────

function fakeEngine(id: SttEngineId, behave: (n: number) => string | number): SttEngine & { calls: number } {
  const e = {
    id,
    label: id,
    calls: 0,
    async transcribeClip() {
      const r = behave(e.calls++);
      if (typeof r === "number") throw new SttHttpError(`${id} ${r}`, r);
      return { text: r, model: `${id}-model` };
    },
  };
  return e;
}
const engines = (m: Partial<Record<SttEngineId, SttEngine>>) => ({ gemini: m.gemini!, openai: m.openai!, groq: m.groq!, custom: m.custom! });
const cand = (engine: SttEngineId): SttCandidate => ({ engine, apiKey: "k", label: `${engine}/org#1` });
const clips = (n: number) => Array.from({ length: n }, () => ({ audio: Buffer.from("a"), mime: "audio/wav" }));
const ctx = { languages: sttLanguagesFor("hi"), vocabulary: [], promptHint: "" };

describe("fallback chain", () => {
  const stub = fakeEngine("custom", () => "x");

  it("uses the first engine when it works", async () => {
    const g = fakeEngine("gemini", () => "from gemini");
    const o = fakeEngine("openai", () => "from openai");
    const r = await transcribeClips([cand("gemini"), cand("openai")], clips(3), ctx, { engines: engines({ gemini: g, openai: o, groq: stub, custom: stub }) });
    assert.deepEqual(r.results.map((x) => x?.text), ["from gemini", "from gemini", "from gemini"]);
    assert.equal(o.calls, 0);
  });

  it("an engine with a bad key / quota is dropped for the whole run", async () => {
    const g = fakeEngine("gemini", () => 429);
    const o = fakeEngine("openai", () => "from openai");
    const r = await transcribeClips([cand("gemini"), cand("openai")], clips(4), ctx, { concurrency: 1, engines: engines({ gemini: g, openai: o, groq: stub, custom: stub }) });
    assert.ok(r.results.every((x) => x?.text === "from openai"));
    assert.equal(g.calls, 1);
    assert.ok(r.failures[0].startsWith("gemini/org#1"));
  });

  it("a clip nobody can transcribe is null; a flaky engine only loses that clip", async () => {
    const g = fakeEngine("gemini", (n) => (n === 1 ? 500 : "ok"));
    const r = await transcribeClips([cand("gemini")], clips(3), ctx, { concurrency: 1, engines: engines({ gemini: g, openai: stub, groq: stub, custom: stub }) });
    assert.deepEqual(r.results.map((x) => x?.text ?? null), ["ok", null, "ok"]);
  });

  it("filters Whisper hallucinations on silence but not Gemini text", async () => {
    const q = fakeEngine("groq", () => "Thank you.");
    const g = fakeEngine("gemini", () => "Thank you");
    const a = await transcribeClips([cand("groq")], clips(1), ctx, { engines: engines({ gemini: g, openai: stub, groq: q, custom: stub }) });
    assert.equal(a.results[0]?.text, "");
    const b = await transcribeClips([cand("gemini")], clips(1), ctx, { engines: engines({ gemini: g, openai: stub, groq: q, custom: stub }) });
    assert.equal(b.results[0]?.text, "Thank you");
  });

  it("pipeline: silence → no clips and no calls; speech → timed clips", async () => {
    const SR = 16000;
    const g = fakeEngine("gemini", () => "answer text");
    const e = engines({ gemini: g, openai: stub, groq: stub, custom: stub });
    const silent = await transcribeAudioClips({ sampleRate: SR, pcm: synth(SR, [{ sec: 5, amp: 0.0005 }]) }, { ...ctx, candidates: [cand("gemini")] }, { engines: e });
    assert.equal(silent.clips.length, 0);
    assert.equal(g.calls, 0);
    const spoken = await transcribeAudioClips(
      { sampleRate: SR, pcm: synth(SR, [{ sec: 1, amp: 0.001 }, { sec: 3, amp: 0.3 }, { sec: 5, amp: 0.001 }, { sec: 2, amp: 0.3 }]) },
      { ...ctx, candidates: [cand("gemini")] },
      { engines: e },
    );
    assert.equal(spoken.clips.length, 2);
    assert.ok(spoken.clips[1].startSec > spoken.clips[0].endSec);
    assert.equal(spoken.unTranscribed, 0);
  });
});

// ── Clean-up guard ──────────────────────────────────────────────────────────

describe("clean-up guard", () => {
  it("accepts a clear name fix and rejects drift", () => {
    const o = "mera naam Dev Ashish hai aur main Fit Pasio mein kaam karta hoon";
    assert.equal(isSafeEdit(o, "mera naam Dewashish hai aur main FitPassio mein kaam karta hoon"), true);
    assert.equal(isSafeEdit(o, "My name is Dewashish and I work at FitPassio as a developer for many years now"), false);
    assert.equal(isSafeEdit(o, ""), false);
    assert.equal(isSafeEdit(o, "mera naam Dev Ashish hai"), false);
  });

  it("never changes numbers or brings Devanagari back", () => {
    assert.equal(isSafeEdit("mera ctc 8.65 LPA hai", "mera ctc 8.56 LPA hai"), false);
    assert.equal(isSafeEdit("mera ctc 8.65 LPA hai", "मेरा ctc 8.65 LPA hai"), false);
    assert.equal(isSafeEdit("mera ctc 8.65 LPA hai", "mera CTC 8.65 LPA hai"), true);
  });

  it("keeps originals for unsafe turns and for a drifting transcript", () => {
    const originals = ["mera naam Dev Ashish hai ji", "main 5 saal se kaam kar raha hoon yahan"];
    const r = applyCleanupGuard(originals, ["mera naam Dewashish hai ji", "x"]);
    assert.deepEqual(r.texts, ["mera naam Dewashish hai ji", originals[1]]);
    assert.equal(r.changed, 1);
    assert.equal(r.rejected, 1);
    // each turn within ±15% but the transcript as a whole drifts: all rejected
    const long = Array.from({ length: 10 }, () => "a b c d e f");
    const trimmed = long.map((t) => t.split(" ").slice(0, 4).join(" "));
    assert.equal(applyCleanupGuard(long, trimmed).wholeRejected, true);
  });

  it("runs the model per batch and returns originals if the model fails", async () => {
    const turns = [{ text: "mera naam Dev Ashish hai ji", question: "What is your name?" }];
    const ctx = { hindi: true, vocabulary: ["Dewashish"] };
    const seen: string[] = [];
    const ok = await cleanupTranscript(
      turns,
      ctx,
      async (system, user) => {
        seen.push(system, user);
        return JSON.stringify({ turns: [{ id: 0, text: "mera naam Dewashish hai ji" }] });
      },
      JSON.parse,
    );
    assert.equal(ok.ran, true);
    assert.deepEqual(ok.texts, ["mera naam Dewashish hai ji"]);
    assert.match(seen[0], /Roman-script Hinglish/);
    assert.match(seen[0], /Dewashish/);
    assert.match(seen[1], /What is your name/);

    const failed = await cleanupTranscript(turns, ctx, async () => { throw new Error("no provider"); }, JSON.parse);
    assert.equal(failed.ran, false);
    assert.deepEqual(failed.texts, [turns[0].text]);
    assert.match(failed.error ?? "", /no provider/);
  });
});

// ── Alignment ───────────────────────────────────────────────────────────────

describe("mic-only alignment", () => {
  const t0 = 1_800_000_000_000;
  const anchors = [
    { timestamp: new Date(t0 + 5_000).toISOString(), questionId: "q1" },
    { timestamp: new Date(t0 + 40_000).toISOString(), questionId: "q2" },
    { timestamp: new Date(t0 + 80_000).toISOString(), questionId: "q3" },
  ];
  const lines = ["Please introduce yourself.", "What is your current CTC?", "What is your notice period?"];

  it("puts each mic clip after the last interviewer line saved before it", () => {
    const turns = micClipsToTurns(
      [
        { text: "mera naam Dewashish hai", startMs: t0 + 9_000, endMs: t0 + 14_000 },
        { text: "aur main Flutter developer hoon", startMs: t0 + 15_000, endMs: t0 + 20_000 },
        { text: "mera CTC 8.65 LPA hai", startMs: t0 + 45_000, endMs: t0 + 48_000 },
        { text: "thirty days", startMs: t0 + 90_000, endMs: t0 + 92_000 },
      ],
      anchors.map((a) => Date.parse(a.timestamp)),
    );
    assert.deepEqual(turns.map((t) => t.afterLine), [1, 1, 2, 3]);
    const out = alignCandidateTurns(turns, anchors, lines);
    assert.deepEqual(out.map((o) => o.questionId), ["q1", "q1", "q2", "q3"]);
    assert.deepEqual(out.map((o) => o.text), ["mera naam Dewashish hai", "aur main Flutter developer hoon", "mera CTC 8.65 LPA hai", "thirty days"]);
    const ts = out.map((o) => Date.parse(o.timestamp));
    assert.ok(ts[0] > Date.parse(anchors[0].timestamp) && ts[0] < Date.parse(anchors[1].timestamp));
    assert.ok([...ts].sort((a, b) => a - b).every((v, i) => v === ts[i]));
  });

  it("a candidate who starts just before the AI line is saved (barge-in) still counts after it; speech before any line goes to the start", () => {
    const turns = micClipsToTurns(
      [
        { text: "hello can you hear me", startMs: t0 + 1_000, endMs: t0 + 2_000 },
        { text: "yes sure", startMs: t0 + 39_500, endMs: t0 + 41_000 },
      ],
      anchors.map((a) => Date.parse(a.timestamp)),
    );
    assert.deepEqual(turns.map((t) => t.afterLine), [0, 2]);
  });

  it("drops empty clips and still strips any AI echo that leaked onto the mic", () => {
    const turns = micClipsToTurns(
      [
        { text: "  ", startMs: t0 + 9_000, endMs: t0 + 9_500 },
        { text: "What is your current CTC?", startMs: t0 + 41_000, endMs: t0 + 43_000 },
        { text: "mera CTC 8.65 LPA hai", startMs: t0 + 45_000, endMs: t0 + 48_000 },
      ],
      anchors.map((a) => Date.parse(a.timestamp)),
    );
    assert.equal(turns.length, 2);
    const out = alignCandidateTurns(turns, anchors, lines);
    assert.deepEqual(out.map((o) => o.text), ["mera CTC 8.65 LPA hai"]);
  });
});

describe("mixed-track diarization by saved lines", () => {
  it("labels clips that repeat a saved interviewer line as the interviewer and keeps the rest", () => {
    const lines = ["Please introduce yourself and tell me about your experience.", "What is your current CTC?"];
    const turns = diarizeByLines(
      [
        { text: "Please introduce yourself and tell me about", startSec: 2, endSec: 6 },
        { text: "mera naam Dewashish hai aur main Flutter developer hoon", startSec: 8, endSec: 14 },
        { text: "What is your current CTC?", startSec: 20, endSec: 22 },
        { text: "mera current CTC 8.65 LPA hai", startSec: 24, endSec: 27 },
      ],
      lines,
    );
    assert.deepEqual(turns.map((t) => t.speaker), ["interviewer", "candidate", "interviewer", "candidate"]);
    assert.deepEqual(turns.filter((t) => t.speaker === "interviewer").map((t) => t.afterLine), [1, 2]);
    const anchors = [
      { timestamp: "2026-01-01T00:00:05.000Z", questionId: "q1" },
      { timestamp: "2026-01-01T00:00:40.000Z", questionId: "q2" },
    ];
    const out = alignCandidateTurns(turns, anchors, lines);
    assert.deepEqual(out.map((o) => o.questionId), ["q1", "q2"]);
  });
});
