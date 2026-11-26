import assert from "node:assert/strict";
import test from "node:test";

import {
  clipAnswerSnippet,
  emptyLedger,
  isPresenceAck,
  isSubstantiveCandidateAnswer,
  isSufficientShortAnswer,
  ledgerPromptBlock,
  looksLikeReask,
  questionEchoed,
  reaskCorrectionCue,
  recordAnswer,
  silencePresenceAckCue,
} from "@/lib/voice/answered-ledger";

test("recordAnswer replaces same index and sorts", () => {
  let L = emptyLedger();
  L = recordAnswer(L, 2, "Expected CTC?", "3 LPA");
  L = recordAnswer(L, 0, "Relocate to Bilaspur?", "Yes");
  L = recordAnswer(L, 2, "Expected CTC?", "4 to 5 LPA, negotiable");
  assert.deepEqual(
    L.entries.map((e) => [e.index, e.answerSnippet]),
    [
      [0, "Yes"],
      [2, "4 to 5 LPA, negotiable"],
    ],
  );
});

test("ledgerPromptBlock lists locked Q→A and bans reconfirm wording", () => {
  const L = recordAnswer(emptyLedger(), 1, "1 year commitment?", "Yes");
  const block = ledgerPromptBlock(L);
  assert.match(block, /LOCKED/);
  assert.match(block, /never "just confirm"/);
  assert.match(block, /Q2: "1 year commitment\?" → "Yes"/);
  assert.equal(ledgerPromptBlock(emptyLedger()), "");
});

test("looksLikeReask: true on just-to-confirm of locked commitment", () => {
  let L = emptyLedger();
  L = recordAnswer(L, 1, "Are you comfortable for 1 year commitment?", "Yes");
  L = recordAnswer(L, 2, "What is your expected CTC?", "4 to 5 LPA, negotiable");
  assert.equal(
    looksLikeReask(
      "Just to confirm, are you comfortable for 1 year commitment?",
      L,
      4,
    ),
    true,
  );
  assert.equal(
    looksLikeReask("Can you reiterate, what was your expected CTC?", L, 4),
    true,
  );
});

test("looksLikeReask: behavioral / ERP question echoed after lock", () => {
  let L = emptyLedger();
  L = recordAnswer(
    L,
    0,
    "Could you walk us through your work at Garg Web Infotech building the Franchise and Inventory ERP system, particularly how you designed the role-based access control and stock transfer workflows?",
    "I used JWT with role permissions tables for admin and employee.",
  );
  assert.equal(
    looksLikeReask(
      "My apologies, going back to the first question. Could you walk us through your work at Garg Web Infotech building the Franchise and Inventory ERP system?",
      L,
      5,
    ),
    true,
  );
  assert.equal(
    looksLikeReask(
      "Thinking back to your experience at AvalonTribe Infotech, you mentioned optimizing page performance.",
      L,
      5,
    ),
    false,
  );
});

test("looksLikeReask: current question re-read after already answered", () => {
  const q =
    "What specific techniques did you use for code splitting, memoization, and preventing unnecessary re-renders in large React applications?";
  const L = recordAnswer(emptyLedger(), 3, q, "I used React.lazy and useMemo for product lists.");
  assert.equal(
    looksLikeReask(
      "What specific techniques did you use for code splitting, memoization, and preventing unnecessary re-renders in large React applications?",
      L,
      3,
    ),
    true,
  );
});

test("looksLikeReask: false on normal follow-up about current question", () => {
  let L = emptyLedger();
  L = recordAnswer(L, 0, "Relocate to Bilaspur, Chhattisgarh?", "Yes");
  const spoken =
    "Thanks for sharing. Could you go deeper on the React.lazy code-splitting you used for the product page?";
  assert.equal(looksLikeReask(spoken, L, 3), false);
});

test("looksLikeReask: false when ledger empty", () => {
  assert.equal(looksLikeReask("anything", emptyLedger(), 0), false);
});

test("questionEchoed catches long scripted prefixes", () => {
  const q =
    "Since this role requires full MERN stack capabilities, how experienced are you with Node.js, Express, and MongoDB on the backend?";
  assert.equal(
    questionEchoed(
      "Since this role requires full MERN stack capabilities, how experienced are you with Node.js, Express, and MongoDB?",
      q,
    ),
    true,
  );
  assert.equal(questionEchoed("Tell me more about indexes you chose.", q), false);
});

test("isSubstantiveCandidateAnswer locks any real turn", () => {
  assert.equal(isSubstantiveCandidateAnswer("Yes"), true);
  assert.equal(isSubstantiveCandidateAnswer("I used React.lazy and WebP images."), true);
  assert.equal(isSubstantiveCandidateAnswer("And"), false);
  assert.equal(isSubstantiveCandidateAnswer("um"), false);
  assert.equal(isSubstantiveCandidateAnswer("skip"), false);
});

test("isSufficientShortAnswer: screening yes / salary; not open behavioral", () => {
  assert.equal(
    isSufficientShortAnswer("Are you willing to relocate to Bilaspur, Chhattisgarh?", "Yes"),
    true,
  );
  assert.equal(
    isSufficientShortAnswer("What is your expected CTC?", "4 to 5 LPA, negotiable"),
    true,
  );
  assert.equal(
    isSufficientShortAnswer("Are you comfortable for 1 year commitment?", "Yes"),
    true,
  );
  assert.equal(
    isSufficientShortAnswer(
      "How did you design role-based access control in the ERP?",
      "Yes",
    ),
    false,
  );
  assert.equal(isSufficientShortAnswer("Expected CTC?", "And"), false);
});

test("isPresenceAck and silencePresenceAckCue", () => {
  assert.equal(isPresenceAck("Yes"), true);
  assert.equal(isPresenceAck("I can hear you"), true);
  assert.equal(isPresenceAck("4 to 5 LPA"), false);
  const cue = silencePresenceAckCue(4, "Tell me about code splitting.");
  assert.match(cue, /only confirmed they are still connected/);
  assert.match(cue, /Do NOT repeat question 5/);
});

test("reaskCorrectionCue distinguishes current vs earlier lock", () => {
  const L = recordAnswer(emptyLedger(), 2, "Performance techniques?", "lazy loading");
  const current = reaskCorrectionCue(L, 2, "Performance techniques?");
  assert.match(current, /already answered it/);
  const earlier = reaskCorrectionCue(
    recordAnswer(emptyLedger(), 0, "Relocate?", "Yes"),
    2,
    "Performance techniques?",
  );
  assert.match(earlier, /already LOCKED/);
  assert.equal(clipAnswerSnippet(""), "(answered)");
  assert.ok(clipAnswerSnippet("x".repeat(300)).endsWith("…"));
});
