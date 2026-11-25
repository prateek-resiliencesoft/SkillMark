import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  agentIdentity,
  candidateIdentity,
  compareStyle,
  computeStyleMetrics,
  normalizeCopilot,
  normalizePlan,
  speakerRoleForIdentity,
  userIdentity,
} from "@/lib/round-two/types";
import { buildGoogleAuthUrl, pkcePair, signOAuthState, verifyOAuthState } from "@/lib/google-oauth";

describe("round two identities", () => {
  it("maps LiveKit identities to transcript speaker roles", () => {
    assert.equal(speakerRoleForIdentity(candidateIdentity("r1")), "candidate");
    assert.equal(speakerRoleForIdentity(userIdentity("u1")), "interviewer");
    assert.equal(speakerRoleForIdentity(agentIdentity("r1")), null);
    assert.equal(speakerRoleForIdentity("someone"), null);
  });
});

describe("computeStyleMetrics", () => {
  it("returns null with no spoken words", () => {
    assert.equal(computeStyleMetrics([]), null);
    assert.equal(computeStyleMetrics(["   ", ""]), null);
  });

  it("counts words, fillers and diversity", () => {
    const m = computeStyleMetrics(["um I built the api", "so you know it scaled"]);
    assert.ok(m);
    assert.equal(m.words, 10);
    assert.equal(m.answers, 2);
    assert.equal(m.avgWordsPerAnswer, 5);
    // um, so, "you know"
    assert.equal(m.fillerRatio, 0.3);
    assert.equal(m.wordsPerMinute, null);
  });

  it("derives words per minute only from timed segments of 5s+", () => {
    const text = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    const m = computeStyleMetrics([{ speakerRole: "candidate", text, startMs: 0, endMs: 10_000 }]);
    assert.equal(m?.wordsPerMinute, 120);
  });
});

describe("compareStyle", () => {
  const base = { words: 100, answers: 10, avgWordsPerAnswer: 10, wordsPerMinute: 120, fillerRatio: 0.02, lexicalDiversity: 0.5 };

  it("is quiet when profiles are similar or missing", () => {
    assert.deepEqual(compareStyle(base, { ...base, avgWordsPerAnswer: 12 }), []);
    assert.deepEqual(compareStyle(null, base), []);
  });

  it("flags large shifts in length, fillers and vocabulary", () => {
    const notes = compareStyle(base, { ...base, avgWordsPerAnswer: 30, fillerRatio: 0.1, lexicalDiversity: 0.8 });
    assert.equal(notes.length, 3);
    assert.match(notes[0], /much longer/);
  });
});

describe("normalizePlan", () => {
  it("drops invalid items, fills ids and clamps fields", () => {
    const plan = normalizePlan([
      { text: "Walk me through the cache design", category: "technical", minutes: 500 },
      { question: "Why did you leave?", category: "nonsense", followUps: ["a", "", "b"] },
      { text: "" },
      null,
      { id: "q1", text: "duplicate id" },
    ]);
    assert.equal(plan.length, 3);
    assert.equal(plan[0].id, "q1");
    assert.equal(plan[0].minutes, 60);
    assert.equal(plan[1].category, "other");
    assert.deepEqual(plan[1].followUps, ["a", "b"]);
    assert.notEqual(plan[2].id, "q1");
  });

  it("returns [] for non-arrays", () => {
    assert.deepEqual(normalizePlan({ text: "x" }), []);
  });
});

describe("normalizeCopilot", () => {
  it("keeps only known plan ids and valid entries", () => {
    const r = normalizeCopilot(
      {
        suggestions: [
          { type: "cross_check", question: "You said X in round 1?", reason: "contradiction", planId: "q2" },
          { type: "weird", question: "Next?", planId: "nope" },
          { question: "" },
        ],
        flags: [{ kind: "contradiction", detail: "Team size differs", quote: "5 people" }, { detail: "" }],
        coveredQuestionIds: ["q1", "zz"],
        liveSummary: "- solid",
      },
      ["q1", "q2"],
    );
    assert.equal(r.suggestions.length, 2);
    assert.equal(r.suggestions[0].planId, "q2");
    assert.equal(r.suggestions[1].type, "follow_up");
    assert.equal(r.suggestions[1].planId, undefined);
    assert.equal(r.flags.length, 1);
    assert.deepEqual(r.coveredQuestionIds, ["q1"]);
    assert.equal(r.liveSummary, "- solid");
  });

  it("tolerates garbage", () => {
    assert.deepEqual(normalizeCopilot("oops", []), { suggestions: [], flags: [], coveredQuestionIds: [], liveSummary: "" });
  });
});

describe("google oauth helpers", () => {
  const PREV = process.env.AUTH_SECRET;
  before(() => {
    process.env.AUTH_SECRET = "test-auth-secret-with-at-least-32-chars!!";
  });
  after(() => {
    if (PREV === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = PREV;
  });

  it("builds an S256 PKCE pair", () => {
    const { verifier, challenge } = pkcePair();
    assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  });

  it("puts PKCE, state and login hint on the auth URL", () => {
    const u = new URL(buildGoogleAuthUrl({ clientId: "cid", redirectUri: "https://x/cb", state: "st", challenge: "ch", loginHint: "a@b.co" }));
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("code_challenge"), "ch");
    assert.equal(u.searchParams.get("state"), "st");
    assert.equal(u.searchParams.get("login_hint"), "a@b.co");
  });

  it("round-trips signed state and rejects tampering", async () => {
    const token = await signOAuthState({ state: "s1", verifier: "v1", next: "/r2/join/abc" });
    assert.deepEqual(await verifyOAuthState(token), { state: "s1", verifier: "v1", next: "/r2/join/abc" });
    assert.equal(await verifyOAuthState(token.slice(0, -2) + "xx"), null);
    assert.equal(await verifyOAuthState(null), null);
  });
});
