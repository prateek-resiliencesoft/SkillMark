import test from "node:test";
import assert from "node:assert/strict";
import {
  createClientErrorLimiter,
  entryFromError,
  errorLogToCsv,
  redactSecrets,
  sanitizeContext,
  summarizeErrorLog,
} from "../src/lib/session-error-log";

const SID = "11111111-2222-3333-4444-555555555555";

test("redacts API keys from messages and context", () => {
  const fake = "AIza" + "x".repeat(35);
  const m = redactSecrets(`failed wss://host/x?key=${fake}&alt=1 and ${fake}`);
  assert.ok(!m.includes(fake));
  const c = sanitizeContext({ apiKey: "secret", keySource: "org", note: `sk-${"a".repeat(30)}` });
  assert.equal(c.apiKey, undefined);
  assert.equal(c.keySource, "org");
  assert.ok(!String(c.note).includes("a".repeat(30)));
});

test("429 / RESOURCE_EXHAUSTED becomes a rate_limit entry", () => {
  const err = Object.assign(new Error("429 RESOURCE_EXHAUSTED: quota exceeded"), { status: 429 });
  const e = entryFromError(SID, err, { category: "ai", source: "api/ai/chat", context: { keySource: "org", failover: true } });
  assert.equal(e.category, "rate_limit");
  assert.equal(e.status, 429);
  assert.equal(e.code, "RESOURCE_EXHAUSTED");
  assert.equal(e.context?.originalCategory, "ai");
});

test("summary counts categories, failovers and impact", () => {
  const none = summarizeErrorLog([]);
  assert.equal(none.impact, "none");
  const s = summarizeErrorLog([
    { category: "rate_limit", severity: "warning", createdAt: "2026-11-02T10:00:00Z", context: { failover: true, keySource: "org" } },
    { category: "voice", severity: "critical", createdAt: "2026-11-02T10:05:00Z", context: { keySource: "env" } },
  ]);
  assert.equal(s.total, 2);
  assert.equal(s.rateLimitHits, 1);
  assert.equal(s.failovers, 1);
  assert.equal(s.envKeyUsed, 1);
  assert.equal(s.impact, "high");
  assert.equal(s.firstAt, "2026-11-02T10:00:00Z");
  assert.equal(s.lastAt, "2026-11-02T10:05:00Z");
});

test("client limiter caps per-minute reports per session", () => {
  const allow = createClientErrorLimiter(2, 3);
  assert.equal(allow(SID, 0), true);
  assert.equal(allow(SID, 1), true);
  assert.equal(allow(SID, 2), false);
  assert.equal(allow(SID, 61_000), true);
  assert.equal(allow(SID, 61_001), false); // total cap 3
  assert.equal(allow("other", 0), true);
});

test("csv export escapes fields", () => {
  const csv = errorLogToCsv([{ sessionId: SID, category: "client", severity: "error", source: "client", message: 'a,"b"' }]);
  assert.ok(csv.split("\n")[1].includes('"a,""b"""'));
});
