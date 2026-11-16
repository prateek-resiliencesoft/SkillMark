/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveScopes,
  generateApiKey,
  hashApiKey,
  isApiKeyAuthHeader,
  keyHasScope,
  parseBearerKey,
  verifyApiKey,
} from "../src/lib/api-keys";
import { ENDPOINTS } from "../src/server/public-api/endpoints";
import { buildOpenApiSpec } from "../src/server/public-api/openapi";
import { ListSessionsQuery } from "../src/server/public-api/schemas";
import {
  ApiProblem,
  decodeCursor,
  encodeCursor,
  getResult,
  getSession,
  getTranscript,
  listCandidates,
  listInterviews,
  listSessions,
  likeExact,
  reportStatusOf,
  toTranscript,
} from "../src/server/public-api/service";
import { buildUrl, listOperations, snippets } from "../src/lib/api-docs";
import { mcpConfigs, MCP_KEY_PLACEHOLDER } from "../src/components/developers/mcp-config";
import { fakeDb } from "./fake-db";

/* ---------------- keys ---------------- */

test("keys: rsi_ prefix, only the hash identifies the key", () => {
  const live = generateApiKey("live");
  assert.match(live.key, /^rsi_live_[a-z0-9]{32}$/);
  assert.equal(live.prefix, live.key.slice(0, 16));
  assert.equal(live.hash, hashApiKey(live.key));
  assert.equal(live.hash.length, 64);
  assert.ok(!live.hash.includes(live.key.slice(9)));
  assert.ok(verifyApiKey(live.key, live.hash));
  assert.ok(!verifyApiKey(live.key + "x", live.hash));
  assert.ok(!verifyApiKey(generateApiKey("live").key, live.hash));
  assert.notEqual(generateApiKey("live").key, live.key);
});

test("keys: bearer parsing accepts rsi_ and legacy dlv_, rejects others", () => {
  assert.equal(parseBearerKey("Bearer rsi_live_abc"), "rsi_live_abc");
  assert.equal(parseBearerKey("bearer dlv_test_abc"), "dlv_test_abc");
  assert.equal(parseBearerKey("Bearer eyJhbGciOi.jwt"), null);
  assert.equal(parseBearerKey("rsi_live_abc"), null);
  assert.equal(parseBearerKey(`Bearer rsi_${"a".repeat(300)}`), null);
  assert.equal(parseBearerKey(null), null);
  assert.ok(isApiKeyAuthHeader("Bearer rsi_live_x"));
  assert.ok(!isApiKeyAuthHeader("Bearer some.jwt.token"));
});

test("scopes: exact scopes for new keys, read implied by write, legacy keys keep access", () => {
  assert.ok(keyHasScope(["*"], "invites:write"));
  assert.ok(keyHasScope(["sessions:read"], "sessions:read"));
  assert.ok(!keyHasScope(["sessions:read"], "results:read"));
  assert.ok(!keyHasScope(["sessions:read"], "transcripts:read"));
  assert.ok(!keyHasScope(["results:read"], "invites:write"));
  assert.ok(keyHasScope(["interviews:write"], "interviews:read"));

  // New key with interviews:read does NOT get results.
  assert.ok(!keyHasScope(effectiveScopes(["interviews:read"], "rsi_live_abcdefg"), "results:read"));
  // Old dlv_ key with interviews:read keeps reading sessions/results as before.
  const legacy = effectiveScopes(["interviews:read"], "dlv_live_abcdefg");
  for (const s of ["sessions:read", "results:read", "transcripts:read", "candidates:read"] as const) assert.ok(keyHasScope(legacy, s));
  assert.ok(!keyHasScope(legacy, "invites:write"));
  assert.deepEqual(effectiveScopes([], "rsi_live_x"), ["*"]);
});

/* ---------------- org isolation ---------------- */

const ORG_A = { organizationId: "org-a", projectIds: ["pa"] };
const ORG_B = { organizationId: "org-b", projectIds: ["pb"] };
const IA = "11111111-1111-4111-8111-111111111111";
const IB = "22222222-2222-4222-8222-222222222222";
const SA1 = "aaaaaaaa-0000-4000-8000-000000000001";
const SA2 = "aaaaaaaa-0000-4000-8000-000000000002";
const SB1 = "bbbbbbbb-0000-4000-8000-000000000001";

function world() {
  return fakeDb({
    interviews: [
      { id: IA, title: "A role", projectId: "pa", isActive: true, mode: "VOICE", createdAt: "2026-11-01T00:00:00Z" },
      { id: IB, title: "B role", projectId: "pb", isActive: true, mode: "CHAT", createdAt: "2026-11-02T00:00:00Z" },
    ],
    sessions: [
      {
        id: SA1, interviewId: IA, status: "COMPLETED", createdAt: "2026-11-10T10:00:00Z", participantEmail: "x@a.com",
        summary: "Solid.", reportStatus: "READY",
        insights: { keyInsights: ["k"], questionEvaluations: [{ question: "Q1", score: 8, highlights: ["clear"], improvements: ["depth"] }] },
      },
      { id: SA2, interviewId: IA, status: "IN_PROGRESS", createdAt: "2026-11-11T10:00:00Z", participantEmail: "y@a.com" },
      { id: SB1, interviewId: IB, status: "COMPLETED", createdAt: "2026-11-12T10:00:00Z", participantEmail: "z@b.com", summary: "B secret" },
    ],
    candidates: [
      { id: "ca1", interviewId: IA, name: "Asha", email: "x@a.com", sessionId: SA1, createdAt: "2026-11-09T00:00:00Z" },
      { id: "ca2", interviewId: IA, name: "Ravi", email: "r@a.com", sessionId: null, createdAt: "2026-11-09T01:00:00Z" },
      { id: "cb1", interviewId: IB, name: "Bob", email: "z@b.com", sessionId: SB1, createdAt: "2026-11-09T02:00:00Z" },
    ],
    messages: [
      { id: "m1", sessionId: SA1, role: "ASSISTANT", content: "Q1", contentType: "TEXT", timestamp: "2026-11-10T10:00:01Z" },
      { id: "m2", sessionId: SA1, role: "USER", content: "Answer", contentType: "TEXT", timestamp: "2026-11-10T10:00:02Z" },
      { id: "m3", sessionId: SA1, role: "SYSTEM", content: "internal", contentType: "TEXT", timestamp: "2026-11-10T10:00:03Z" },
      { id: "m4", sessionId: SB1, role: "USER", content: "B answer", contentType: "TEXT", timestamp: "2026-11-12T10:00:02Z" },
    ],
  });
}

const q = (o: Record<string, unknown> = {}) => ListSessionsQuery.parse(o);

test("isolation: lists only show the key's organization", async () => {
  const db = world();
  const a = await listSessions({ db, auth: ORG_A }, q());
  assert.deepEqual(a.data.map((s) => s.id), [SA2, SA1]);
  assert.equal(a.data[1].candidate_name, "Asha");
  const b = await listSessions({ db, auth: ORG_B }, q());
  assert.deepEqual(b.data.map((s) => s.id), [SB1]);

  const ints = await listInterviews({ db, auth: ORG_A }, { limit: 20 });
  assert.deepEqual(ints.data.map((i) => i.id), [IA]);
  assert.equal(ints.data[0].session_count, 2);
  assert.equal(ints.data[0].completed_count, 1);

  const cands = await listCandidates({ db, auth: ORG_A }, { limit: 20 });
  assert.deepEqual(cands.data.map((c) => [c.name, c.status]), [["Ravi", "invited"], ["Asha", "completed"]]);

  const none = await listSessions({ db, auth: { organizationId: "org-c", projectIds: [] } }, q());
  assert.deepEqual(none, { data: [], next_cursor: null });
});

test("isolation: another org's ids answer 404, not data", async () => {
  const db = world();
  for (const fn of [getSession, getResult, getTranscript]) {
    await assert.rejects(fn({ db, auth: ORG_A }, SB1), (e: unknown) => e instanceof ApiProblem && e.status === 404);
  }
  await assert.rejects(
    listSessions({ db, auth: ORG_A }, q({ interview_id: IB })),
    (e: unknown) => e instanceof ApiProblem && e.status === 404,
  );
  await assert.rejects(
    listCandidates({ db, auth: ORG_A }, { interview_id: IB, limit: 20 }),
    (e: unknown) => e instanceof ApiProblem && e.status === 404,
  );
  const ok = await getSession({ db, auth: ORG_B }, SB1);
  assert.equal(ok.data.id, SB1);
});

test("filters, result and transcript", async () => {
  const db = world();
  const done = await listSessions({ db, auth: ORG_A }, q({ status: "COMPLETED" }));
  assert.deepEqual(done.data.map((s) => s.id), [SA1]);
  const byEmail = await listSessions({ db, auth: ORG_A }, q({ candidate_email: "X@A.com" }));
  assert.deepEqual(byEmail.data.map((s) => s.id), [SA1]);
  const ranged = await listSessions({ db, auth: ORG_A }, q({ from: "2026-11-11T00:00:00Z" }));
  assert.deepEqual(ranged.data.map((s) => s.id), [SA2]);

  const r = await getResult({ db, auth: ORG_A }, SA1);
  assert.equal(r.data.report_status, "ready");
  assert.equal(r.data.overall_score, 8);
  assert.equal(r.data.recommendation, "hire");
  assert.deepEqual(r.data.strengths, ["clear"]);
  assert.deepEqual(r.data.weaknesses, ["depth"]);
  assert.equal(r.data.summary, "Solid.");

  const pending = await getResult({ db, auth: ORG_A }, SA2);
  assert.equal(pending.data.report_status, "none");
  assert.equal(pending.data.overall_score, null);
  assert.equal(pending.data.recommendation, null);

  const t = await getTranscript({ db, auth: ORG_A }, SA1);
  assert.deepEqual(t.data.messages.map((m) => m.role), ["interviewer", "candidate"]);
});

test("pagination cursor", async () => {
  const db = world();
  const p1 = await listSessions({ db, auth: ORG_A }, q({ limit: 1 }));
  assert.deepEqual(p1.data.map((s) => s.id), [SA2]);
  assert.ok(p1.next_cursor);
  const p2 = await listSessions({ db, auth: ORG_A }, q({ limit: 1, cursor: p1.next_cursor }));
  assert.deepEqual(p2.data.map((s) => s.id), [SA1]);
  assert.equal(p2.next_cursor, null);
  assert.equal(decodeCursor(encodeCursor("2026-11-10T10:00:00Z")), "2026-11-10T10:00:00Z");
  assert.throws(() => decodeCursor("not-a-cursor"), (e: unknown) => e instanceof ApiProblem && e.status === 400);
  assert.equal(decodeCursor(undefined), null);
});

test("query validation", () => {
  assert.equal(ListSessionsQuery.parse({}).limit, 20);
  assert.equal(ListSessionsQuery.parse({ limit: "5" }).limit, 5);
  assert.ok(!ListSessionsQuery.safeParse({ limit: "500" }).success);
  assert.ok(!ListSessionsQuery.safeParse({ status: "DONE" }).success);
  assert.ok(!ListSessionsQuery.safeParse({ from: "yesterday" }).success);
  assert.equal(reportStatusOf({ reportStatus: "GENERATING" }), "generating");
  assert.equal(reportStatusOf({ summary: "x" }), "ready");
  assert.deepEqual(toTranscript([{ role: "SYSTEM", content: "x" }]), []);
  assert.equal(likeExact("A_b%@X.com"), "a\\_b\\%@x.com");
});

/* ---------------- spec ---------------- */

test("OpenAPI spec is generated from the endpoint schemas", () => {
  const spec = buildOpenApiSpec("https://example.test") as any;
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.servers[0].url, "https://example.test/api/v1");
  for (const e of ENDPOINTS) {
    const op = spec.paths[e.path]?.[e.method.toLowerCase()];
    assert.ok(op, `${e.method} ${e.path} missing`);
    assert.equal(op.operationId, e.id);
    assert.equal(op["x-scope"], e.scope);
    assert.ok(op.responses[String(e.successStatus)].content["application/json"].schema);
    assert.ok(op.responses["401"] && op.responses["429"]);
    // Every documented query param exists in the zod schema and vice versa.
    const docParams = op.parameters.filter((p: any) => p.in === "query").map((p: any) => p.name).sort();
    assert.deepEqual(docParams, Object.keys(e.query?.shape ?? {}).sort());
  }
  const list = spec.paths["/sessions"].get;
  const status = list.parameters.find((p: any) => p.name === "status");
  assert.deepEqual(status.schema.enum, ["IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"]);
  assert.equal(status.required, false);
  assert.equal(spec.paths["/sessions/{id}"].get.parameters[0].required, true);
  assert.ok(spec.paths["/invites"].post.requestBody.content["application/json"].schema.required.includes("interview_id"));
  // Older endpoints are still documented.
  assert.ok(spec.paths["/interviews"].post);
  assert.ok(spec.paths["/interview-forms"].get);
  assert.ok(spec.components.schemas.Error);
  assert.ok(!JSON.stringify(spec).includes("Aural"));
});

test("docs helpers build requests from the spec", () => {
  const spec = buildOpenApiSpec("https://example.test");
  const ops = listOperations(spec);
  const getRes = ops.find((o) => o.key === "GET /sessions/{id}/result")!;
  assert.equal(getRes.scope, "results:read");
  assert.equal(getRes.mcpTool, "get_result");
  const url = buildUrl("https://example.test/api/v1", getRes, { id: SA1 });
  assert.equal(url, `https://example.test/api/v1/sessions/${SA1}/result`);
  const list = ops.find((o) => o.key === "GET /sessions")!;
  assert.equal(buildUrl("https://h/api/v1", list, { status: "COMPLETED", limit: "" }), "https://h/api/v1/sessions?status=COMPLETED");
  const s = snippets(url, "POST", '{"a":true}');
  assert.match(s.curl, /Authorization: Bearer \$RSI_API_KEY/);
  assert.match(s.python, /json=\{\n\s+"a": True\n\s+\}/);
  assert.match(s.javascript, /process\.env\.RSI_API_KEY/);
});

test("MCP config snippets never contain a real key", () => {
  const c = mcpConfigs("https://example.test/api/mcp");
  for (const v of Object.values(c)) {
    assert.ok(v.includes(MCP_KEY_PLACEHOLDER));
    assert.ok(!/rsi_(live|test)_[a-z0-9]{32}/.test(v));
  }
  assert.equal(JSON.parse(c.cursor).mcpServers["resiliencesoft-interview"].url, "https://example.test/api/mcp");
});

test("operationIds are unique across the whole spec", () => {
  const spec = buildOpenApiSpec() as any;
  const ids: string[] = [];
  for (const item of Object.values<any>(spec.paths)) for (const op of Object.values<any>(item)) if (op?.operationId) ids.push(op.operationId);
  assert.equal(new Set(ids).size, ids.length);
});
