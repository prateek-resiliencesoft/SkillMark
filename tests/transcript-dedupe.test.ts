import assert from "node:assert/strict";
import test from "node:test";

import { handleVoiceSave } from "@/app/api/voice/save/logic";
import { compareUserLines, dropRepeatedUserLines, joinTranscriptChunk } from "@/lib/transcript/dedupe";
import { shouldResumeAfterClose, silentPcmBase64 } from "@/lib/voice/relay-keepalive";

const ANSWER =
  "Yeah, as per the company norms and market standard, I'll be happy and approx like 4.5 to 5 LPA.";

test("joinTranscriptChunk adds a space where streaming chunks would glue words", () => {
  assert.equal(joinTranscriptChunk("My expectation is", "Yes. Ah."), "My expectation is Yes. Ah.");
  assert.equal(joinTranscriptChunk("5 LPA.", "My expectation"), "5 LPA. My expectation");
  assert.equal(joinTranscriptChunk("I was", " getting"), "I was getting");
  assert.equal(joinTranscriptChunk("work", "ing"), "working");
  assert.equal(joinTranscriptChunk("", "Hello"), "Hello");
});

test("compareUserLines spots repeats regardless of punctuation and case", () => {
  assert.equal(compareUserLines(ANSWER, ANSWER), "same");
  assert.equal(compareUserLines(ANSWER, ANSWER.toUpperCase().replace(/,/g, "")), "same");
  assert.equal(compareUserLines(ANSWER, "as per the company norms and market standard"), "contained");
  assert.equal(compareUserLines(ANSWER, `${ANSWER} My expectation is 5 LPA`), "extends");
  assert.equal(
    compareUserLines(ANSWER, "Yes, as per the company norms and market standard, I'll be happy and approx 4.5 to 5 LPA."),
    "similar",
  );
  assert.equal(compareUserLines("Yes.", "Yes."), "same");
  assert.equal(compareUserLines("I worked on Apex triggers.", "I also used batch Apex for large data volumes."), null);
  assert.equal(compareUserLines(null, ANSWER), null);
});

test("dropRepeatedUserLines removes repeated candidate lines but keeps new content", () => {
  const msgs = [
    { role: "user", content: ANSWER },
    { role: "user", content: ANSWER },
    { role: "user", content: `${ANSWER} My expectation is negotiable.` },
    { role: "assistant", content: "Are you willing to relocate?" },
    { role: "user", content: "Yes, I am willing to relocate." },
  ];
  const { kept, dropped } = dropRepeatedUserLines({ role: "USER", content: ANSWER }, msgs);
  assert.equal(dropped, 2);
  assert.deepEqual(
    kept.map((m) => m.content),
    [`${ANSWER} My expectation is negotiable.`, "Are you willing to relocate?", "Yes, I am willing to relocate."],
  );
  // An interviewer line in between means a repeat is a fresh answer.
  const r = dropRepeatedUserLines({ role: "ASSISTANT", content: "Could you repeat?" }, [{ role: "user", content: "Yes." }]);
  assert.equal(r.dropped, 0);
});

test("voice save skips a candidate line that repeats the last saved one", async () => {
  const inserted: string[] = [];
  const result = await handleVoiceSave(
    {
      sessionId: "s1",
      messages: [
        { role: "user", content: "Yes, in my previous organization I was getting 2.17 LPA." },
        { role: "assistant", content: "And what is your expected CTC range?" },
      ],
    },
    {
      async insertMessages(_id, messages) {
        inserted.push(...messages.map((m) => m.content));
      },
      async loadLastMessage() {
        return { role: "USER", content: "Yes, in my previous organization I was getting 2.17 LPA." };
      },
      async loadSessionForCompletion() { return null; },
      async loadFirstMessageTimestamp() { return null; },
      async loadSessionForProgress() { return null; },
      async updateSession() {},
      async generateSummary() {},
      log: { info() {}, error() {} },
      now: () => new Date("2026-11-13T06:00:00Z"),
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(inserted, ["And what is your expected CTC range?"]);
});

test("relay keepalive helpers", () => {
  assert.equal(Buffer.from(silentPcmBase64(), "base64").length, 3200);
  assert.ok(Buffer.from(silentPcmBase64(), "base64").every((b) => b === 0));
  assert.equal(shouldResumeAfterClose(1008, "Session closed due to client inactivity."), true);
  assert.equal(shouldResumeAfterClose(1011, "Internal error encountered."), false);
  assert.equal(shouldResumeAfterClose(1001, ""), true);
});
