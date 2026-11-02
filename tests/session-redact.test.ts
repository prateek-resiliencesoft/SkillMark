import test from "node:test";
import assert from "node:assert/strict";
import { redactSessionForCandidate } from "../src/lib/session-redact";

test("non-member view strips interviewer-only data but keeps candidate fields", () => {
  const s = {
    id: "s1", status: "IN_PROGRESS", messages: [], summary: "x", insights: {}, antiCheatingLog: [1],
    interview: { id: "i1", title: "T", questions: [{ text: "q" }], assessmentCriteria: [1], invitedEmails: ["a"] },
  };
  const r = redactSessionForCandidate(s) as Record<string, any>;
  assert.equal(r.id, "s1");
  assert.equal(r.summary, undefined);
  assert.equal(r.antiCheatingLog, undefined);
  assert.equal(r.interview.title, "T");
  assert.equal(r.interview.questions.length, 1);
  assert.equal(r.interview.assessmentCriteria, undefined);
  assert.equal(r.interview.invitedEmails, undefined);
});
