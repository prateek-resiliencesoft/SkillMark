/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * W4 recheck: SKILLMARK-APIKEY-LEGACY-SCOPE-BYPASS,
 * SKILLMARK-APIKEY-MISSING-ROLE-AND-ORG-STATUS-BINDING,
 * SKILLMARK-MCP-GET-SESSION-RESULTS-SCOPE-BYPASS,
 * SKILLMARK-APIKEY-CREATE-PRIVILEGE-ESCALATION and
 * SKILLMARK-APIKEY-ROTATE-REVOKED-RESURRECTION.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { FAKE_POSTGREST_URL, installFakePostgrest, type FakePostgrest } from "./sec-w4-fake-postgrest";

process.env.AUTH_SECRET = "w4-test-auth-secret-0123456789abcdef";
process.env.POSTGREST_URL = FAKE_POSTGREST_URL;

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEWER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAUSED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORG = "0a000000-0000-4000-8000-000000000001";
const ORG_SUSPENDED = "0a000000-0000-4000-8000-000000000002";
const ORG_DELETED = "0a000000-0000-4000-8000-000000000003";
const SESSION = "5e000000-0000-4000-8000-000000000001";

let keys: typeof import("@/lib/api-keys");
let auth: typeof import("@/lib/api-key-auth");
let publish: (typeof import("@/app/api/v1/interviews/[id]/publish/route"))["POST"];
let candidatesGet: (typeof import("@/app/api/v1/interviews/[id]/candidates/route"))["GET"];
let mcp: typeof import("@/server/integrations/mcp-server");
let apiKeyRouter: (typeof import("@/server/routers/apikey"))["apiKeyRouter"];
let supabaseAdmin: (typeof import("@/lib/supabase/admin"))["supabaseAdmin"];
let db: FakePostgrest;

before(async () => {
  keys = await import("@/lib/api-keys");
  auth = await import("@/lib/api-key-auth");
  ({ POST: publish } = await import("@/app/api/v1/interviews/[id]/publish/route"));
  ({ GET: candidatesGet } = await import("@/app/api/v1/interviews/[id]/candidates/route"));
  mcp = await import("@/server/integrations/mcp-server");
  ({ apiKeyRouter } = await import("@/server/routers/apikey"));
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
});

const user = (id: string, paused = false) => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  encrypted_password: "x",
  raw_user_meta_data: {},
  created_at: "2026-01-01T00:00:00Z",
  paused_at: paused ? "2026-02-01T00:00:00Z" : null,
  deleted_at: null,
  token_version: 0,
});

/** Plaintext keys by label, created fresh per test. */
let plain: Record<string, string>;

function addKey(label: string, row: Record<string, unknown>) {
  const { key, hash, prefix } = keys.generateApiKey("live");
  plain[label] = key;
  db.tables["public.api_keys"].push({
    id: `key-${label}`,
    name: label,
    keyHash: hash,
    keyPrefix: prefix,
    environment: "live",
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    ...row,
  });
}

beforeEach(() => {
  db?.restore();
  db = installFakePostgrest({
    "auth.users": [user(ADMIN), user(VIEWER), user(MEMBER), user(PAUSED, true)],
    "public.organizations": [
      { id: ORG, status: "ACTIVE" },
      { id: ORG_SUSPENDED, status: "SUSPENDED" },
      { id: ORG_DELETED, status: "DELETED" },
    ],
    "public.organization_members": [
      { id: "m1", organizationId: ORG, userId: ADMIN, role: "ADMIN" },
      { id: "m2", organizationId: ORG, userId: VIEWER, role: "VIEWER" },
      { id: "m3", organizationId: ORG, userId: MEMBER, role: "MEMBER" },
      { id: "m4", organizationId: ORG, userId: PAUSED, role: "ADMIN" },
      { id: "m5", organizationId: ORG_SUSPENDED, userId: ADMIN, role: "ADMIN" },
      { id: "m6", organizationId: ORG_DELETED, userId: ADMIN, role: "ADMIN" },
    ],
    "public.projects": [
      { id: "p1", organizationId: ORG },
      { id: "p2", organizationId: ORG_SUSPENDED },
      { id: "p3", organizationId: ORG_DELETED },
    ],
    "public.project_members": [],
    "public.interviews": [
      { id: "iv-1", projectId: "p1", isActive: false, requireInvite: true, publicSlug: "slug-1" },
      { id: "iv-2", projectId: "p2", isActive: false, requireInvite: true, publicSlug: "slug-2" },
    ],
    "public.candidates": [
      { id: "c1", interviewId: "iv-1", name: "Cand", email: "c@example.com", phone: null, notes: null, inviteToken: "secret-invite", sessionId: null, createdAt: "2026-01-02" },
    ],
    "public.sessions": [
      { id: SESSION, interviewId: "iv-1", status: "COMPLETED", participantName: "Cand", participantEmail: "c@example.com", summary: "s", insights: {}, themes: [], sentiment: null, antiCheatingLog: [] },
    ],
    "public.messages": [
      { id: "msg1", sessionId: SESSION, role: "SYSTEM", content: "hidden prompt", contentType: "TEXT", timestamp: "1" },
      { id: "msg2", sessionId: SESSION, role: "ASSISTANT", content: "Hi", contentType: "TEXT", timestamp: "2" },
      { id: "msg3", sessionId: SESSION, role: "USER", content: "Hello", contentType: "TEXT", timestamp: "3" },
    ],
    "public.api_keys": [],
    "public.api_usage_logs": [],
  });
  plain = {};
  addKey("formsRead", { userId: ADMIN, organizationId: ORG, scopes: ["forms:read"] });
  addKey("adminFull", { userId: ADMIN, organizationId: ORG, scopes: ["*"] });
  addKey("viewerFull", { userId: VIEWER, organizationId: ORG, scopes: ["*"] });
  addKey("suspendedFull", { userId: ADMIN, organizationId: ORG_SUSPENDED, scopes: ["*"] });
  addKey("deletedFull", { userId: ADMIN, organizationId: ORG_DELETED, scopes: ["*"] });
  addKey("pausedFull", { userId: PAUSED, organizationId: ORG, scopes: ["*"] });
  addKey("interviewsRead", { userId: ADMIN, organizationId: ORG, scopes: ["interviews:read"] });
  addKey("candidatesRead", { userId: ADMIN, organizationId: ORG, scopes: ["candidates:read"] });
  addKey("results", { userId: ADMIN, organizationId: ORG, scopes: ["sessions:read", "results:read"] });
  addKey("resultsTranscripts", { userId: ADMIN, organizationId: ORG, scopes: ["sessions:read", "results:read", "transcripts:read"] });
});

after(() => db?.restore());

const bearer = (label: string, init: RequestInit = {}) =>
  new Request("https://app.test/api/v1/x", { ...init, headers: { authorization: `Bearer ${plain[label]}` } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const iv1 = () => db.tables["public.interviews"].find((i) => i.id === "iv-1")!;

describe("legacy /api/v1 handlers enforce scopes", () => {
  it("a forms:read key can no longer publish an invite-only interview (exploit path)", async () => {
    const res = await publish(bearer("formsRead", { method: "POST" }), params("iv-1"));
    assert.equal(res.status, 403);
    assert.equal(iv1().requireInvite, true);
    assert.equal(iv1().isActive, false);
  });

  it("a full-access admin key still publishes", async () => {
    const res = await publish(bearer("adminFull", { method: "POST" }), params("iv-1"));
    assert.equal(res.status, 200);
    assert.equal(iv1().requireInvite, false);
  });

  it("candidates:read lists candidates without their invite tokens", async () => {
    const res = await candidatesGet(bearer("candidatesRead"), params("iv-1"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    assert.equal(body.data.length, 1);
    assert.equal("inviteToken" in body.data[0]!, false);
    const forms = await candidatesGet(bearer("formsRead"), params("iv-1"));
    assert.equal(forms.status, 403);
  });

  it("validateApiKey accepts a list of required scopes", async () => {
    const r = await auth.validateApiKey(bearer("results"), ["sessions:read", "results:read", "transcripts:read"]);
    assert.ok(r instanceof Response);
    assert.equal(r.status, 403);
  });
});

describe("key owner role, org status and account state", () => {
  it("a VIEWER's full-access key is read-only", async () => {
    const res = await publish(bearer("viewerFull", { method: "POST" }), params("iv-1"));
    assert.equal(res.status, 403);
    assert.equal(iv1().requireInvite, true);
    const read = await auth.validateApiKey(bearer("viewerFull"), "interviews:read");
    assert.ok(!(read instanceof Response));
    assert.equal(read.readOnly, true);
    assert.ok(!read.scopes!.includes("*"));
    assert.ok(!read.scopes!.some((s) => s.endsWith(":write")));
  });

  it("a SUSPENDED organization's key cannot write but can read", async () => {
    const res = await publish(bearer("suspendedFull", { method: "POST" }), params("iv-2"));
    assert.equal(res.status, 403);
    const read = await auth.validateApiKey(bearer("suspendedFull"), "interviews:read");
    assert.ok(!(read instanceof Response));
  });

  it("a DELETED organization's key is rejected", async () => {
    const r = await auth.validateApiKey(bearer("deletedFull"), "interviews:read");
    assert.ok(r instanceof Response);
    assert.equal(r.status, 403);
  });

  it("a paused account's key is rejected", async () => {
    const r = await auth.validateApiKey(bearer("pausedFull"), "interviews:read");
    assert.ok(r instanceof Response);
    assert.equal(r.status, 401);
  });
});

describe("MCP get_session_results", () => {
  async function callTool(label: string, args: Record<string, unknown>) {
    const a = await auth.validateApiKey(bearer(label), null);
    assert.ok(!(a instanceof Response));
    const server = mcp.buildMcpServer(a, new Request("https://app.test/api/mcp"));
    const tool = (server as any)._registeredTools.get_session_results;
    return (await tool.handler(args, {})) as { isError?: boolean; content: { text: string }[] };
  }

  it("rejects an interviews:read key (exploit path)", async () => {
    const r = await callTool("interviewsRead", { session_id: SESSION, include_transcript: true });
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /sessions:read|results:read/);
  });

  it("requires transcripts:read for include_transcript", async () => {
    const noTx = await callTool("results", { session_id: SESSION, include_transcript: true });
    assert.equal(noTx.isError, true);
    assert.match(noTx.content[0]!.text, /transcripts:read/);
    const ok = await callTool("results", { session_id: SESSION, include_transcript: false });
    assert.notEqual(ok.isError, true);
  });

  it("returns only candidate/interviewer turns in the transcript", async () => {
    const r = await callTool("resultsTranscripts", { session_id: SESSION, include_transcript: true });
    assert.notEqual(r.isError, true);
    const out = JSON.parse(r.content[0]!.text);
    const roles = (out.data ?? out).transcript.map((m: { role: string }) => m.role);
    assert.deepEqual(roles.sort(), ["ASSISTANT", "USER"]);
  });
});

describe("apiKey router", () => {
  const caller = (id: string) => apiKeyRouter.createCaller({ supabase: supabaseAdmin, user: { id, email: "u@example.com", user_metadata: {} } } as never);
  const keyCount = () => db.tables["public.api_keys"].length;

  for (const [label, id] of [["VIEWER", VIEWER], ["MEMBER", MEMBER]] as const) {
    it(`apiKey.create rejects a ${label} (exploit path)`, async () => {
      const before = keyCount();
      await assert.rejects(() => caller(id).create({ name: "x", organizationId: ORG }), (e: any) => e.code === "FORBIDDEN");
      assert.equal(keyCount(), before);
    });
  }

  it("apiKey.create no longer issues unbound (organizationId: null) keys", async () => {
    await assert.rejects(() => caller(VIEWER).create({ name: "x" }), (e: any) => e.code === "BAD_REQUEST");
  });

  it("apiKey.create rejects admins of a suspended org, allows admins of an active org", async () => {
    await assert.rejects(() => caller(ADMIN).create({ name: "x", organizationId: ORG_SUSPENDED }), (e: any) => e.code === "FORBIDDEN");
    const r = await caller(ADMIN).create({ name: "ok", organizationId: ORG });
    assert.ok(r.key.startsWith("rsi_"));
  });

  it("apiKey.rotate refuses to resurrect a revoked key (exploit path)", async () => {
    addKey("revoked", { userId: VIEWER, organizationId: ORG, scopes: ["*"], isActive: false, revokedAt: "2026-03-01T00:00:00Z" });
    const before = keyCount();
    await assert.rejects(() => caller(VIEWER).rotate({ id: "key-revoked" }), (e: any) => e.code === "BAD_REQUEST");
    assert.equal(keyCount(), before);
  });

  it("apiKey.rotate requires ADMIN even for the caller's own active key", async () => {
    await assert.rejects(() => caller(VIEWER).rotate({ id: "key-viewerFull" }), (e: any) => e.code === "FORBIDDEN");
  });

  it("apiKey.orgRotate refuses revoked and expired keys", async () => {
    addKey("revokedOrg", { userId: ADMIN, organizationId: ORG, scopes: ["*"], isActive: false, revokedAt: "2026-03-01T00:00:00Z" });
    addKey("expiredOrg", { userId: ADMIN, organizationId: ORG, scopes: ["*"], expiresAt: "2020-01-01T00:00:00Z" });
    const before = keyCount();
    // orgRotate's input schema requires uuid ids.
    const uuidify = (label: string) => {
      const row = db.tables["public.api_keys"].find((k) => k.name === label)!;
      row.id = crypto.randomUUID();
      return row.id as string;
    };
    await assert.rejects(() => caller(ADMIN).orgRotate({ organizationId: ORG, id: uuidify("revokedOrg") }), (e: any) => e.code === "BAD_REQUEST");
    await assert.rejects(() => caller(ADMIN).orgRotate({ organizationId: ORG, id: uuidify("expiredOrg") }), (e: any) => e.code === "BAD_REQUEST");
    assert.equal(keyCount(), before);
  });

  it("apiKey.orgRotate still rotates an active key", async () => {
    const row = db.tables["public.api_keys"].find((k) => k.name === "adminFull")!;
    row.id = crypto.randomUUID();
    const r = await caller(ADMIN).orgRotate({ organizationId: ORG, id: row.id as string });
    assert.ok(r.key.startsWith("rsi_"));
    assert.equal(row.isActive, false);
  });
});
