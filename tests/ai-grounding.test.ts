import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignSpan, chunkText, wordOverlap } from "@/lib/ai/extract/align";
import { dedupeExtractions, type GroundedExtraction } from "@/lib/ai/extract";
import type { RoundTwoReport } from "@/lib/round-two/types";
import { planGaps, relatedPairs, verifyFlags, verifyReportEvidence } from "@/server/round-two/checks";

describe("alignSpan", () => {
  const src = "I led the migration to Kafka.  We cut  latency by 40% in “six weeks”.";

  it("finds exact spans with offsets", () => {
    const a = alignSpan(src, "migration to Kafka");
    assert.deepEqual(a && { ...a, text: src.slice(a.start, a.end) }, { start: 10, end: 28, kind: "exact", text: "migration to Kafka" });
  });

  it("normalizes case, whitespace and smart quotes", () => {
    const a = alignSpan(src, 'we cut latency by 40% in "six weeks"');
    assert.equal(a?.kind, "normalized");
    assert.equal(src.slice(a!.start, a!.end), "We cut  latency by 40% in “six weeks”");
  });

  it("falls back to a fuzzy word window", () => {
    const a = alignSpan("We reduced the p99 latency by forty percent across all services last year.", "reduced the p99 latency by forty percent across services");
    assert.equal(a?.kind, "fuzzy");
  });

  it("rejects quotes that are not in the source", () => {
    assert.equal(alignSpan(src, "I have managed a team of fifty engineers"), null);
    assert.equal(alignSpan(src, "   "), null);
  });
});

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    assert.deepEqual(chunkText("short"), [{ text: "short", offset: 0 }]);
  });

  it("chunks long text with offsets that map back to the source", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(text, 1000, 100);
    assert.ok(chunks.length > 1);
    for (const c of chunks) {
      assert.ok(c.text.length <= 1000);
      assert.equal(text.slice(c.offset, c.offset + c.text.length), c.text);
    }
    assert.equal(chunks.at(-1)!.offset + chunks.at(-1)!.text.length, text.length);
  });
});

describe("wordOverlap", () => {
  it("ignores stop words and scores shared content words", () => {
    assert.equal(wordOverlap("the and of", "the and of"), 0);
    assert.ok(wordOverlap("Built Kafka pipelines", "kafka pipelines at scale") > 0.4);
    assert.equal(wordOverlap("React frontend", "Postgres tuning"), 0);
  });
});

describe("dedupeExtractions", () => {
  const ex = (cls: string, start: number, end: number): GroundedExtraction => ({ class: cls, text: "x", attributes: {}, start, end, alignment: "exact" });

  it("drops same-class overlaps from chunk overlap, keeps other classes", () => {
    const out = dedupeExtractions([ex("skill", 10, 20), ex("skill", 12, 18), ex("metric", 12, 18), ex("skill", 30, 40)]);
    assert.deepEqual(
      out.map((e) => [e.class, e.start]),
      [
        ["skill", 10],
        ["metric", 12],
        ["skill", 30],
      ],
    );
  });
});

describe("planGaps", () => {
  const ctx = { weaknesses: ["Kubernetes networking"], claims: [{ claim: "Reduced AWS costs by 30%" }] };

  it("reports unprobed weaknesses, claims and overlong plans", () => {
    const gaps = planGaps([{ id: "q1", text: "Tell me about yourself", category: "other", minutes: 50 }], ctx, [], 30);
    assert.equal(gaps.length, 3);
    assert.match(gaps[0], /weakness not probed: Kubernetes/);
    assert.match(gaps[1], /claim not cross-checked/);
    assert.match(gaps[2], /~50 min/);
  });

  it("is empty when the plan covers everything", () => {
    const gaps = planGaps(
      [
        { id: "q1", text: "How does Kubernetes networking work between pods?", category: "technical", minutes: 10 },
        { id: "q2", text: "Walk me through how you reduced AWS costs", category: "probe_round1", minutes: 10 },
      ],
      ctx,
      [],
      30,
    );
    assert.deepEqual(gaps, []);
  });
});

describe("relatedPairs", () => {
  it("pairs new claims with the closest earlier statement", () => {
    const pairs = relatedPairs(
      [{ class: "claim", text: "I migrated our billing service to Kafka" }],
      { claims: [{ claim: "Owned the billing service Kafka migration" }], cvClaims: [{ class: "skill", text: "Figma" }] },
      [],
    );
    assert.deepEqual(pairs, [{ claim: "I migrated our billing service to Kafka", related: "Owned the billing service Kafka migration", source: "round 1" }]);
  });

  it("skips unrelated claims", () => {
    assert.deepEqual(relatedPairs([{ class: "tool", text: "Terraform" }], { claims: [{ claim: "Designed the onboarding UI" }] }, []), []);
  });
});

describe("verifyFlags", () => {
  const transcript = "Candidate: honestly I only used Kafka for a week";

  it("marks located quotes verified and snaps them to the source text", () => {
    const [f] = verifyFlags([{ kind: "contradiction", detail: "d", quote: "i only used kafka for a week", round1Quote: "two years of Kafka" }], transcript, "I have two years of Kafka in production");
    assert.equal(f.verified, true);
    assert.equal(f.quote, "I only used Kafka for a week");
  });

  it("flags invented quotes", () => {
    const [f] = verifyFlags([{ kind: "red_flag", detail: "d", quote: "I lied on my CV about everything" }], transcript, "");
    assert.equal(f.verified, false);
  });
});

describe("verifyReportEvidence", () => {
  const base: RoundTwoReport = {
    summary: "",
    recommendation: "lean_yes",
    confidence: 0.5,
    overallScore: 6,
    strengths: [],
    concerns: [],
    questions: [
      { question: "q1", answerSummary: "", score: 7, evidence: 'They said "we sharded the orders table by region"' },
      { question: "q2", answerSummary: "", score: 3, evidence: '"I wrote the whole compiler myself"' },
      { question: "q3", answerSummary: "", score: 5 },
    ],
    round1Comparison: { consistency: "mixed", notes: [], contradictions: [{ round1: "x", round2: "we sharded the orders table" }] },
    style: { round1: null, round2: null, notes: [] },
    panel: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("counts verified and unverified quotes", () => {
    const r = verifyReportEvidence(base, "So we sharded the orders table by region last year.");
    assert.deepEqual(
      r.questions.map((q) => q.evidenceVerified),
      [true, false, undefined],
    );
    assert.deepEqual(r.evidenceCheck, { verified: 2, unverified: 1 });
  });
});
