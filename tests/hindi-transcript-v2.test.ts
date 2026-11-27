/**
 * Hindi / Hinglish transcript v2 (live test 27 Nov): English words written in
 * Devanagari came out letter by letter ("eksapiriyans"), a precomposed "ज़"
 * survived, the candidate's name was misheard, "Helo" turns made the
 * interviewer go back, and the recording pass died on a 3-requests-a-minute quota.
 * Strings below are the exact ones from that session.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { devanagariToRoman, hasDevanagari, repairRomanHinglish } from "@/lib/transcript/transliterate";
import { isMetaReply, isPresenceCheck, isSubstantiveCandidateAnswer, presenceCheckCue } from "@/lib/voice/answered-ledger";
import { decideQuestionMove, interviewerQuestionOpen } from "@/lib/voice/question-progress";
import { rateLimitWaitMs, STT_ENGINES, type SttCandidate, type SttClipRequest } from "@/lib/transcript/stt-engines";
import { mergeSpeechSegments } from "@/lib/transcript/stt-pipeline";
import { buildVocabulary } from "@/lib/transcript/stt-vocab";
import { buildCleanupPrompt, isSafeEdit } from "@/lib/transcript/cleanup";
import { buildRelayInterviewContext, type RelaySessionStore } from "../server/relay-security";

const VOCAB = ["Dewashish", "ResilienceSoft", "ResilioHub", "Flutter", "Dart", "Firebase"];

describe("Devanagari → Hinglish (live transcript)", () => {
  it("brings English words back to English spelling (raw Gemini Live text from the session)", () => {
    const raw =
      "हां, मेरे को 3 साल एक्सपीरियंस है एज़ अ फ्लटर डेवलपर। करेंटली मैं रिजिलिएंट सॉफ्टवेयर में वर्क करता हूं और मैंने कुछ एप्लीकेशन बनाई हुई है। जैसे कि जिम एप्लीकेशन जो कि यूजर को उनके घर के पास में जिम सर्विस प्रोवाइड कराने में मदद करता है, और रेजिलियो हब जो कि लीड्स को मैनेज करने में मदद करता है।";
    assert.equal(
      devanagariToRoman(raw, { vocabulary: VOCAB }),
      "Haan, mere ko 3 saal experience hai as a Flutter developer. Currently main resilient software mein work karta hun aur maine kuch application banaai hui hai. Jaise ki gym application jo ki user ko unke ghar ke paas mein gym service provide karaane mein madad karta hai, aur ResilioHub jo ki leads ko manage karne mein madad karta hai.",
    );
  });

  it("matches the invited candidate's name and keeps Hindi words around it", () => {
    assert.equal(devanagariToRoman("मैं कह रहा था कि मेरा नाम देवाशीष है।", { vocabulary: VOCAB }), "Main kah raha tha ki mera naam Dewashish hai.");
    assert.equal(devanagariToRoman("कह रहा था मैं सॉफ्टवेयर डेवलपमेंट की फील्ड के लिए रेडी हूं।"), "Kah raha tha main software development ki field ke liye ready hun.");
    assert.equal(devanagariToRoman("हेलो। हेलो।"), "Hello. Hello.");
    assert.equal(devanagariToRoman("मेरा करंट सीटीसी 8.65 एलपीए है और नोटिस पीरियड 30 डेज का है।"), "Mera current CTC 8.65 LPA hai aur notice period 30 days ka hai.");
  });

  it("joins a company name split in two words (real Gemini Live output)", () => {
    assert.equal(
      devanagariToRoman("करेंटली मैं रेजिलिएंस सॉफ्ट में वर्क कर रहा हूं।", { vocabulary: VOCAB }),
      "Currently main ResilienceSoft mein work kar raha hun.",
    );
    assert.equal(devanagariToRoman("और रिजलियो हब, जो कि लीड्स को मैनेज करने में", { vocabulary: VOCAB }), "Aur ResilioHub, jo ki leads ko manage karne mein");
    assert.equal(devanagariToRoman("सॉफ्ट स्किल्स", { vocabulary: VOCAB }), "Soft skills");
  });

  it("never leaves Devanagari, including precomposed nukta letters (U+095B ज़)", () => {
    const out = devanagariToRoman("एज\u095B अ फ्लटर \u095B\u0958\u095E");
    assert.equal(hasDevanagari(out), false);
    assert.equal(devanagariToRoman("\u095Bरूर"), "Zarur");
  });

  it("short words that are also Hindi only turn English next to English", () => {
    assert.equal(devanagariToRoman("आई एम वर्किंग ऑन फ्लटर एंड इट्स अमेज़िंग।"), "I am working on Flutter and it's amazing.");
    assert.equal(devanagariToRoman("वो कल आई थी। इन लोगों ने सो लिया।"), "Woh kal aai thi. In logon ne so liya.");
  });

  it("leaves plain Hindi alone", () => {
    const hi = "मैं घर जा रहा हूं। मुझे नींद आई और मैं सो गया। दो साल पहले मैं दिल्ली में था। उनको मदद चाहिए। वह जो कहता है करता है।";
    assert.equal(
      devanagariToRoman(hi, { vocabulary: [...VOCAB, "Akash"] }),
      "Main ghar ja raha hun. Mujhe nind aai aur main so gaya. Do saal pahle main dilli mein tha. Unko madad chahiye. Woh jo kahta hai karta hai.",
    );
  });
});

describe("repair of already-stored letter-by-letter text (the exact lines shown on 27 Nov)", () => {
  const cases: Array<[string, string]> = [
    [
      "Haan, mere ko 3 saal eksapiriyans hai eज़ a phlatar devalapar. Karentli main rijilient sophtaveyar mein vark karta hun aur maine kuchh eplikeshan banaai hui hai. Jaise ki jim eplikeshan jo ki yujar ko unke ghar ke paas mein jim sarvis provaaid karaane ke lie madad karta hai aur rijiliyo hab jo ki lids ko mainej karne mein madad karta hai.",
      "Haan, mere ko 3 saal experience hai as a Flutter developer. Currently main resilient software mein work karta hun aur maine kuchh application banaai hui hai. Jaise ki gym application jo ki user ko unke ghar ke paas mein gym service provide karaane ke liye madad karta hai aur ResilioHub jo ki leads ko manage karne mein madad karta hai.",
    ],
    ["Main kah raha tha ki mera naam devaashish hai.", "Main kah raha tha ki mera naam Dewashish hai."],
    ["Kah raha tha main sophtaveyar devalapment ki phild ke lie redi hun.", "Kah raha tha main software development ki field ke liye ready hun."],
    ["Helo. Helo.", "Hello. Hello."],
    ["Karentli main rejiliens sopht mein vark kar raha hun.", "Currently main ResilienceSoft mein work kar raha hun."],
    ["Karentli aai em varking on rejyume sopht end mainejment saaid.", "Currently I am working on resume soft and management side."],
  ];
  for (const [before, after] of cases) {
    it(before.slice(0, 40), () => assert.equal(repairRomanHinglish(before, { vocabulary: VOCAB }), after));
  }

  it("does not touch normal Roman Hindi", () => {
    const ro = "Main ghar ja raha hoon. Mujhe neend aai aur main so gaya. In baaton ka koi matlab nahi. Mera naam Akash hai.";
    assert.equal(repairRomanHinglish(ro, { vocabulary: [...VOCAB, "Akash"] }), ro);
  });
});

describe("hello / can-you-hear-me turns", () => {
  it("are presence checks and meta replies, never answers", () => {
    for (const t of ["Helo.", "Hello. Hello.", "हेलो। हेलो।", "Hello? Can you hear me?", "aap sun pa rahe hain?", "Kya aap mujhe sun pa rahe hain?", "Meri awaaz aa rahi hai?"]) {
      assert.equal(isPresenceCheck(t), true, t);
      assert.equal(isMetaReply(t), true, t);
      assert.equal(isSubstantiveCandidateAnswer(t, "Tell me about your experience."), false, t);
    }
    assert.equal(isPresenceCheck("Hello, mera naam Dewashish hai aur mujhe 3 saal ka experience hai"), false);
  });

  it("cue: yes I can hear you, then the CURRENT question, never back", () => {
    const cue = presenceCheckCue(1, "Aapka current CTC kya hai?", { hindi: true, asked: true });
    assert.match(cue, /Haan, aapki awaaz aa rahi hai/);
    assert.match(cue, /repeat question 2 once/);
    assert.match(cue, /Never go back to an earlier question/);
    assert.match(cue, /do not call any function/);
  });
});

describe("question change after an answer (no false pending_question)", () => {
  it("the reply turn's own transition question is not an unanswered question", () => {
    assert.equal(
      interviewerQuestionOpen({
        candidateSinceModel: false,
        turnRepliesToCandidate: true,
        currentTurnText: "Bahut badhiya, Dewashish. Chaliye aage badhte hain. Aapka notice period kitna hai?",
        earlierAssistantText: "",
      }),
      false,
    );
  });
  it("a follow-up asked in a turn of its own still blocks a move", () => {
    assert.equal(
      interviewerQuestionOpen({ candidateSinceModel: false, turnRepliesToCandidate: false, currentTurnText: "Kaunsa state management use kiya?", earlierAssistantText: "" }),
      true,
    );
    assert.equal(
      interviewerQuestionOpen({ candidateSinceModel: true, turnRepliesToCandidate: false, currentTurnText: "Kaunsa?", earlierAssistantText: "" }),
      false,
    );
  });
  it("so the answered intro moves to Q2 instead of being rejected", () => {
    const d = decideQuestionMove(
      { current: 0, total: 5, completed: new Set(), userSpokeThisQuestion: true, dwellMs: 60_000, minDwellMs: 15_000, openInterviewerQuestion: false },
      { target: 1, userRequested: false, candidateAskedBack: false },
    );
    assert.deepEqual(d, { ok: true, target: 1, end: false });
  });
});

describe("recording pass vs per-minute quotas", () => {
  it("reads the wait Google asks for; daily quotas are not waited on", () => {
    assert.equal(rateLimitWaitMs('{"error":{"details":[{"retryDelay":"23s"}]}}'), 23_000);
    assert.equal(rateLimitWaitMs("Quota exceeded ... Please retry in 7.2s."), 7200);
    assert.equal(rateLimitWaitMs("", "5"), 5000);
    assert.equal(rateLimitWaitMs("Quota exceeded for metric: generate_requests_per_model_per_day"), null);
  });

  it("waits out a 429 on gemini-3.5-transcribe and then succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls === 1) return new Response('{"error":{"code":429,"message":"3 requests per minute","details":[{"retryDelay":"2s"}]}}', { status: 429 });
      return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "text", text: "मेरा नाम देवाशीष है" }] }] }), { status: 200 });
    }) as typeof fetch;
    const cand: SttCandidate = { engine: "gemini", apiKey: "k", label: "gemini/org#1" };
    const req: SttClipRequest = { audio: Buffer.from([0]), mime: "audio/wav", languages: { bcp47: ["hi-IN", "en-IN"], iso: ["hi", "en"], single: "hi", hindi: true }, vocabulary: VOCAB, promptHint: "" };
    const r = await STT_ENGINES.gemini.transcribeClip(cand, req, { fetch: fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(r.text, "मेरा नाम देवाशीष है");
    assert.deepEqual(sleeps, [2500]);
  });

  it("a transcribe-model 429 falls through to the general Gemini models (own quota)", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("/interactions")) return new Response("Quota exceeded per day", { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "mera naam Dewashish hai" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const cand: SttCandidate = { engine: "gemini", apiKey: "k", label: "gemini/org#1" };
    const req: SttClipRequest = { audio: Buffer.from([0]), mime: "audio/wav", languages: { bcp47: ["hi-IN"], iso: ["hi"], hindi: true }, vocabulary: VOCAB, promptHint: "" };
    const r = await STT_ENGINES.gemini.transcribeClip(cand, req, { fetch: fetchFn, sleep: async () => {} });
    assert.equal(r.text, "mera naam Dewashish hai");
    assert.ok(urls[1].includes(":generateContent"));
  });

  it("stops waiting at the run deadline", async () => {
    const sleeps: number[] = [];
    const fetchFn = (async () => new Response('{"details":[{"retryDelay":"30s"}]}', { status: 429 })) as unknown as typeof fetch;
    const cand: SttCandidate = { engine: "gemini", apiKey: "k", label: "g" };
    const req: SttClipRequest = { audio: Buffer.from([0]), mime: "audio/wav", languages: { bcp47: ["hi-IN"], iso: ["hi"], hindi: true }, vocabulary: [], promptHint: "" };
    await assert.rejects(STT_ENGINES.gemini.transcribeClip(cand, req, { fetch: fetchFn, sleep: async (ms) => { sleeps.push(ms); }, deadlineAt: Date.now() + 5_000 }));
    assert.deepEqual(sleeps, []);
  });

  it("joins pauses inside one answer into one request", () => {
    const merged = mergeSpeechSegments([
      { startSec: 0, endSec: 4 }, { startSec: 5, endSec: 9 }, { startSec: 10.5, endSec: 14 }, // one answer
      { startSec: 30, endSec: 35 }, // next answer after the interviewer spoke
    ]);
    assert.deepEqual(merged, [{ startSec: 0, endSec: 14 }, { startSec: 30, endSec: 35 }]);
    assert.equal(mergeSpeechSegments([{ startSec: 0, endSec: 50 }, { startSec: 51, endSec: 60 }]).length, 2); // ≤55 s per request
  });

  it("speech prompts ask for Roman Hinglish with English words in English", () => {
    const prompt = buildCleanupPrompt({ hindi: true, candidateName: "Dewashish", vocabulary: VOCAB });
    assert.match(prompt, /eksapiriyans → experience/);
    assert.match(prompt, /Candidate name: Dewashish/);
    // One-for-one conversions pass the ±15% guard.
    assert.equal(isSafeEdit("3 saal eksapiriyans hai ez a phlatar devalapar", "3 saal experience hai as a Flutter developer"), true);
    assert.equal(isSafeEdit("aur rijiliyo hab jo ki lids ko mainej karne", "aur ResilioHub jo ki leads ko manage karne"), true);
    const src = readFileSync("src/lib/transcript/stt-engines.ts", "utf8");
    assert.match(src, /never Devanagari/);
  });
});

describe("session vocabulary reaches live transcription", () => {
  it("candidate name from the invite, company and skills are in the relay context", async () => {
    const store: RelaySessionStore = {
      async getSession() { return null; },
      async getInterview() { return null; },
      async getOrganizationStatus() { return "ACTIVE"; },
      async getOrganizationName() { return "ResilienceSoft"; },
      async getCandidate() { return { name: "Dewashish", skills: ["Flutter", "Dart", "Firebase"], tailorInterview: true }; },
      async getRecentLines() { return []; },
    };
    const ctx = await buildRelayInterviewContext(
      store,
      {
        ok: true,
        sessionId: "be0a0182-f321-4110-8fc2-2a7d65a9dd97",
        session: { id: "s", status: "IN_PROGRESS", interviewId: "i", participantName: "akash" },
        interview: { id: "i", title: "Flutter Developer", language: "hi", questions: [{ text: "Apne baare mein batayein", order: 0 }] },
        organizationId: "o",
      },
      {},
    );
    assert.deepEqual(ctx.vocabulary.slice(0, 5), ["Dewashish", "ResilienceSoft", "Flutter", "Dart", "Firebase"]);
    assert.equal(ctx.vocabulary.includes("akash"), false);
  });

  it("buildVocabulary keeps skills right after the names", () => {
    const v = buildVocabulary({ candidateName: "Dewashish", companyName: "ResilienceSoft", terms: ["Flutter", "ResilioHub"] });
    assert.deepEqual(v.slice(0, 4), ["Dewashish", "ResilienceSoft", "Flutter", "ResilioHub"]);
  });

  it("relay wiring: session vocabulary in customVocabulary and the converter; hello handled as presence", () => {
    const src = readFileSync("server/gemini-voice-relay.ts", "utf8");
    assert.match(src, /customVocabulary: liveVocabulary\(opts\.transcriptionVocabulary\)/);
    assert.match(src, /transcriptionLanguages, transcriptionVocabulary, tools: true, resumeHandle/);
    assert.match(src, /devanagariToRoman\(text\.trim\(\), \{ vocabulary: transcriptionVocabulary \}\)/);
    assert.match(src, /isPresenceCheck\(t\)[\s\S]{0,200}presenceCheckCue\(currentQuestionIndex/);
    assert.match(src, /modelTurnRepliesToCandidate = candidateSpeechSinceModel \|\| userTextSinceModel/);
  });
});
