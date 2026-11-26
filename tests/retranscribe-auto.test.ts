import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrompt, recordingTranscriptKeepsWords } from "@/lib/transcript/retranscribe";

describe("auto re-transcribe", () => {
  it("keeps the live transcript when the recording one loses too many words", () => {
    assert.equal(recordingTranscriptKeepsWords(["my name is dewashish and I have five years"], ["my name is Dewashish"]), false);
    assert.equal(recordingTranscriptKeepsWords(["my name is tejaswi"], ["My name is Dewashish."]), true);
    assert.equal(recordingTranscriptKeepsWords([], ["anything"]), true);
  });

  it("prompt uses question context and Indian HR terms", () => {
    const p = buildPrompt(["What is your current CTC?"], "en");
    assert.match(p, /What is your current CTC\?/);
    assert.match(p, /LPA/);
    assert.match(p, /never a time like "5 PM"/);
  });
});
