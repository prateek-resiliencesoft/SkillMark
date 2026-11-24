/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiOrgAccessError, authorizeAiOrg } from "@/lib/ai/org-access";
import { resolveCredentials } from "@/lib/ai/credentials";
import { reportAccess } from "@/lib/report-access";
import { fakeDb } from "./fake-db";

const ORG = "org-victim";
function db(role: string | null, status = "ACTIVE") {
  return fakeDb({
    organizations: [{ id: ORG, name: "Victim", slug: "v", ownerId: "owner", status }],
    organization_members: role ? [{ organizationId: ORG, userId: "attacker", role }] : [],
  }) as any;
}

describe("AI routes: caller-supplied organizationId", () => {
  it("rejects orgs the caller is not a member of (no credential resolution)", async () => {
    await assert.rejects(() => authorizeAiOrg(db(null), "attacker", ORG), (e: unknown) => e instanceof AiOrgAccessError && e.status === 403);
  });

  it("rejects VIEWERs, deleted and suspended orgs", async () => {
    await assert.rejects(() => authorizeAiOrg(db("VIEWER"), "attacker", ORG), AiOrgAccessError);
    await assert.rejects(() => authorizeAiOrg(db("OWNER", "DELETED"), "attacker", ORG), AiOrgAccessError);
    await assert.rejects(() => authorizeAiOrg(db("OWNER", "SUSPENDED"), "attacker", ORG), AiOrgAccessError);
  });

  it("allows active members and keeps the no-org (platform default) path", async () => {
    assert.equal(await authorizeAiOrg(db("MEMBER"), "attacker", ORG), ORG);
    assert.equal(await authorizeAiOrg(db(null), "attacker", undefined), undefined);
    assert.equal(await authorizeAiOrg(db(null), "attacker", ""), undefined);
    await assert.rejects(() => authorizeAiOrg(db(null), "attacker", { $ne: null }), (e: unknown) => e instanceof AiOrgAccessError && e.status === 400);
  });
});

describe("platform env keys never go to a tenant baseUrl", () => {
  it("custom baseUrl without org keys uses a dummy key, flagged untrusted", () => {
    process.env.CUSTOM_LLM_API_KEY = "sk-platform-custom";
    process.env.OPENAI_API_KEY = "sk-platform-openai";
    process.env.GEMINI_API_KEY = "gm-platform";
    try {
      const creds = resolveCredentials({
        custom: { baseUrl: "https://attacker.example/v1" },
        openai: { baseUrl: "https://attacker.example/v1" },
        gemini: { baseUrl: "https://attacker.example/v1" },
      } as any);
      assert.deepEqual(creds.custom.apiKeys, ["ollama"]);
      assert.equal(creds.custom.untrustedBaseUrl, true);
      for (const id of ["openai", "gemini", "nvidia", "anthropic", "grok"] as const) {
        assert.notEqual(creds[id].baseUrl, "https://attacker.example/v1", id);
      }
      assert.deepEqual(creds.openai.apiKeys, ["sk-platform-openai"]);
      assert.equal(creds.openai.from, "env");
    } finally {
      delete process.env.CUSTOM_LLM_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("platform-configured custom endpoint still pairs with platform keys", () => {
    process.env.CUSTOM_LLM_API_KEY = "sk-platform-custom";
    process.env.CUSTOM_LLM_BASE_URL = "http://ollama:11434/v1";
    try {
      const creds = resolveCredentials({});
      assert.deepEqual(creds.custom.apiKeys, ["sk-platform-custom"]);
      assert.equal(creds.custom.baseUrl, "http://ollama:11434/v1");
      assert.ok(!creds.custom.untrustedBaseUrl);
    } finally {
      delete process.env.CUSTOM_LLM_API_KEY;
      delete process.env.CUSTOM_LLM_BASE_URL;
    }
  });
});

describe("aiSettings custom endpoint validation", () => {
  it("org admins cannot point the custom provider at internal addresses", async () => {
    const { aiSettingsRouter } = await import("@/server/routers/aiSettings");
    const caller = aiSettingsRouter.createCaller({ user: { id: "attacker", email: "a@example.com" }, supabase: db("OWNER") } as never);
    for (const baseUrl of [
      "http://127.0.0.1:11434/v1",
      "https://[::ffff:7f00:1]/v1",
      "https://169.254.169.254/latest",
      "https://localhost/v1",
      "https://10.0.0.5/v1#frag",
    ]) {
      await assert.rejects(
        () => caller.saveProviderKeys({ organizationId: ORG, providerId: "custom", baseUrl }),
        /Custom endpoint URL is not allowed/,
        baseUrl,
      );
      await assert.rejects(
        () => caller.save({ organizationId: ORG, providers: { custom: { baseUrl } } }),
        /Custom endpoint URL is not allowed/,
        baseUrl,
      );
    }
  });
});

describe("report regeneration: stale interview creator", () => {
  it("a removed or downgraded creator is denied like anyone else", () => {
    assert.equal(reportAccess({ userId: "u1", interviewOwnerId: "u1", orgRole: null, hasProjectAccess: false }).ok, false);
    assert.equal(reportAccess({ userId: "u1", interviewOwnerId: "u1", orgRole: "VIEWER", hasProjectAccess: true }).ok, false);
    assert.equal(reportAccess({ userId: "u1", interviewOwnerId: "u1", orgRole: "MEMBER", hasProjectAccess: false }).ok, false);
    assert.equal(reportAccess({ userId: "u1", interviewOwnerId: "u1", orgRole: "MEMBER", hasProjectAccess: true }).ok, true);
  });
});
