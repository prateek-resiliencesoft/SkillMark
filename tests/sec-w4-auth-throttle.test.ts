/**
 * W4 recheck: SKILLMARK-AUTH-CLIENTIP-CF-HEADER-SPOOFING (trusted client IP +
 * per-account throttling on login / invite-join).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { FAKE_POSTGREST_URL, installFakePostgrest, type FakePostgrest } from "./sec-w4-fake-postgrest";

process.env.AUTH_SECRET = "w4-test-auth-secret-0123456789abcdef";
process.env.POSTGREST_URL = FAKE_POSTGREST_URL;

let clientIp: (typeof import("@/lib/client-ip"))["clientIp"];
let login: (typeof import("@/app/api/auth/login/route"))["POST"];
let inviteJoin: (typeof import("@/app/api/auth/invite-join/route"))["POST"];
let db: FakePostgrest;

before(async () => {
  ({ clientIp } = await import("@/lib/client-ip"));
  ({ POST: login } = await import("@/app/api/auth/login/route"));
  ({ POST: inviteJoin } = await import("@/app/api/auth/invite-join/route"));
});

beforeEach(() => {
  db?.restore();
  db = installFakePostgrest({
    "auth.users": [
      {
        id: "22222222-2222-4222-8222-222222222222",
        email: "victim@example.com",
        // bcrypt of something the tests never guess
        encrypted_password: "$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z0xYzS1F3sT3kZQ0ZQ0ZQ0ZQ",
        raw_user_meta_data: {},
        created_at: "2026-01-01T00:00:00Z",
        token_version: 0,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        email: "invitee@example.com",
        encrypted_password: "$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z0xYzS1F3sT3kZQ0ZQ0ZQ0ZQ",
        raw_user_meta_data: {},
        created_at: "2026-01-01T00:00:00Z",
        token_version: 0,
      },
    ],
    "public.organization_invites": [
      { id: "inv-1", token: "invite-token-abc123", email: "invitee@example.com", status: "PENDING" },
    ],
  });
});

after(() => db?.restore());

const spoofed = (i: number) => ({ "cf-connecting-ip": `198.51.100.${i % 250}`, "content-type": "application/json" });

describe("clientIp", () => {
  it("ignores client-supplied CF-Connecting-IP by default", () => {
    const h = new Headers({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "10.0.0.9", "x-forwarded-for": "10.0.0.8, 10.0.0.7" });
    assert.equal(clientIp({ headers: h }), "10.0.0.9");
    assert.equal(clientIp({ headers: new Headers({ "cf-connecting-ip": "1.2.3.4" }) }), "unknown");
  });

  it("falls back to the first X-Forwarded-For entry", () => {
    assert.equal(clientIp({ headers: new Headers({ "x-forwarded-for": " 10.0.0.8 , 10.0.0.7" }) }), "10.0.0.8");
  });

  it("honors CF-Connecting-IP only when TRUST_CF_CONNECTING_IP=1", () => {
    process.env.TRUST_CF_CONNECTING_IP = "1";
    try {
      assert.equal(clientIp(new Request("https://x.test", { headers: { "cf-connecting-ip": "1.2.3.4", "x-real-ip": "10.0.0.9" } })), "1.2.3.4");
    } finally {
      delete process.env.TRUST_CF_CONNECTING_IP;
    }
  });
});

describe("login brute force", () => {
  it("rotating CF-Connecting-IP no longer yields fresh per-IP buckets", async () => {
    let limited = false;
    for (let i = 0; i < 61 && !limited; i++) {
      const res = await login(
        new Request("https://app.test/api/auth/login", {
          method: "POST",
          headers: { ...spoofed(i), "x-real-ip": "203.0.113.5" },
          body: JSON.stringify({ email: `user${i}@example.com`, password: "wrong-password" }),
        }),
      );
      if (res.status === 429) limited = true;
    }
    assert.ok(limited, "61 attempts from one real IP must hit the per-IP limit despite spoofed CF headers");
  });

  it("caps password attempts per account across different IPs", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await login(
        new Request("https://app.test/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${i}` },
          body: JSON.stringify({ email: "Victim@Example.com", password: `guess-${i}` }),
        }),
      );
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429);
  });
});

describe("invite-join brute force", () => {
  it("caps password guesses against the invited account", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await inviteJoin(
        new Request("https://app.test/api/auth/invite-join", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${100 + i}` },
          body: JSON.stringify({ token: "invite-token-abc123", password: `guess-${i}` }),
        }),
      );
      last = res.status;
      if (i < 10) assert.notEqual(res.status, 429, `attempt ${i + 1} should not be throttled yet`);
    }
    assert.equal(last, 429);
  });
});
