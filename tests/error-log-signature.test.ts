import test from "node:test";
import assert from "node:assert/strict";
import { errorSignature, normalizeErrorMessage } from "../src/lib/session-error-log";

test("numbers, durations and UUIDs collapse so the same error groups together", () => {
  assert.equal(
    normalizeErrorMessage("stop recording timed out after 30000ms"),
    normalizeErrorMessage("stop recording timed out after 45000ms"),
  );
  assert.equal(
    normalizeErrorMessage("session 11111111-2222-3333-4444-555555555555 failed"),
    normalizeErrorMessage("session aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee failed"),
  );
  assert.equal(normalizeErrorMessage("stop recording timed out after 30000ms"), "stop recording timed out after <n>ms");
});

test("model names keep their version digits", () => {
  const m = normalizeErrorMessage('Google Gemini rejected request for "gemini-3.5-flash" (400, empty body)');
  assert.ok(m.includes("gemini-3.5-flash"), m);
  assert.ok(m.includes("(<n>, empty body)"), m);
  assert.notEqual(m, normalizeErrorMessage('Google Gemini rejected request for "gemini-2.0-flash" (400, empty body)'));
});

test("URLs keep only the host, long random tokens are replaced", () => {
  const m = normalizeErrorMessage("failed wss://voice.example.com/ws/abc?session=1 token x9f8e7d6c5b4a39281706f5e4d3c2b1a");
  assert.ok(m.includes("<url:voice.example.com>"), m);
  assert.ok(m.includes("<token>"), m);
});

test("signature is stable, 16 hex chars, and separates category and source", () => {
  const base = { category: "ai", source: "api/ai/chat", message: "429 quota exceeded for request 123" };
  const sig = errorSignature(base);
  assert.match(sig, /^[0-9a-f]{16}$/);
  assert.equal(sig, errorSignature({ ...base, message: "429 quota exceeded for request 999" }));
  assert.notEqual(sig, errorSignature({ ...base, category: "report" }));
  assert.notEqual(sig, errorSignature({ ...base, source: "report/generate" }));
});
