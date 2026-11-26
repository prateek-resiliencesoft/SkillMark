import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TASK_ROUTING, envTaskRouting, getStoredRouting, taskModelOverride } from "@/lib/ai/credentials";
import { ROUND2_RUBRIC, describeAiError, normalizeLiveScoring } from "@/lib/round-two/types";
import { defaultSttModel, sttShouldFailover } from "@/lib/round-two/stt-config";
import { verifyLiveScoring } from "@/server/round-two/checks";

describe("round 2 per-task AI routing", () => {
  it("has its own task kinds with sensible defaults", () => {
    assert.ok(DEFAULT_TASK_ROUTING.round2_live.length > 0);
    assert.ok(DEFAULT_TASK_ROUTING.round2_scoring.length > 0);
    assert.ok(DEFAULT_TASK_ROUTING.round2_report.length > 0);
    assert.ok(DEFAULT_TASK_ROUTING.round2_transcript.every((id) => ["groq", "openai", "custom"].includes(id)));
  });

  it("reads platform default order from AI_ROUTING_<TASK>", () => {
    assert.deepEqual(envTaskRouting("round2_live", ["openai"], { AI_ROUTING_ROUND2_LIVE: "Groq, gemini, bogus, groq" }), ["groq", "gemini"]);
    assert.deepEqual(envTaskRouting("round2_live", ["openai"], { AI_ROUTING_ROUND2_LIVE: "bogus" }), ["openai"]);
    // Transcript keeps speech-to-text providers only.
    assert.deepEqual(envTaskRouting("round2_transcript", ["groq"], { AI_ROUTING_ROUND2_TRANSCRIPT: "gemini,openai" }), ["openai"]);
  });

  it("reads a per-task model for one provider", () => {
    assert.equal(taskModelOverride("round2_live", "groq", { AI_MODEL_ROUND2_LIVE_GROQ: " llama-3.3-70b-versatile " }), "llama-3.3-70b-versatile");
    assert.equal(taskModelOverride("round2_live", "openai", {}), null);
  });

  it("drops non speech-to-text providers from saved transcript routing", () => {
    const r = getStoredRouting({ routing: { round2_transcript: ["gemini", "groq", "anthropic", "openai"], round2_live: ["gemini"] } });
    assert.deepEqual(r.round2_transcript, ["groq", "openai"]);
    assert.deepEqual(r.round2_live, ["gemini"]);
  });

  it("STT defaults and failover", () => {
    assert.equal(defaultSttModel("groq"), "whisper-large-v3-turbo");
    assert.equal(sttShouldFailover(401), true);
    assert.equal(sttShouldFailover(429), true);
    assert.equal(sttShouldFailover(503), true);
    assert.equal(sttShouldFailover(400), false);
  });
});

describe("round 2 live scoring", () => {
  it("normalizes to the rubric, clamps scores and allows 'not enough evidence'", () => {
    const s = normalizeLiveScoring({
      scores: [
        { criterion: "technical depth", score: 7, reason: "Deep answers", evidence: "we sharded postgres by tenant" },
        { criterion: "Communication", score: "3", reason: "ok" },
        { criterion: "Made up", score: 5 },
      ],
      recommendation: "lean_yes",
      confidence: 1.4,
    });
    assert.deepEqual(s.scores.map((c) => c.criterion), [...ROUND2_RUBRIC]);
    assert.equal(s.scores[0].score, 5);
    assert.equal(s.scores.find((c) => c.criterion === "Communication")?.score, 3);
    assert.equal(s.scores.find((c) => c.criterion === "Ownership")?.score, null);
    assert.equal(s.recommendation, "lean_yes");
    assert.equal(s.confidence, 1);
    assert.equal(normalizeLiveScoring({ recommendation: "hire" }).recommendation, null);
  });

  it("marks evidence that is not in the candidate's words", () => {
    const s = verifyLiveScoring(
      normalizeLiveScoring({
        scores: [
          { criterion: "Technical depth", score: 4, evidence: "we sharded postgres by tenant" },
          { criterion: "Ownership", score: 4, evidence: "I personally rewrote the billing system" },
        ],
      }),
      "Candidate: so we sharded Postgres by tenant to keep queries fast.",
    );
    assert.equal(s.scores[0].verified, true);
    assert.equal(s.scores.find((c) => c.criterion === "Ownership")?.verified, false);
  });

  it("explains AI failures in plain words", () => {
    assert.match(describeAiError(new Error("No LLM provider configured. Add an API key")), /Settings → AI/);
    assert.match(describeAiError(new Error("429 rate limit")), /quota/);
    assert.match(describeAiError(new Error("401 Incorrect API key")), /rejected the API key/);
  });
});
