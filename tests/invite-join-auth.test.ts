import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authenticateForInviteEmail } from "@/server/invite-join-auth";
import type { SessionUser } from "@/lib/auth-session";

const user = (email: string): SessionUser => ({
  id: "u1",
  email,
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
});

describe("authenticateForInviteEmail", () => {
  it("creates an account when the invite email is new", async () => {
    const created = user("new@example.com");
    const result = await authenticateForInviteEmail(
      { email: "New@Example.com", password: "password1", name: "Ada" },
      {
        findUserByEmail: async () => null,
        verifyLogin: async () => {
          throw new Error("should not login");
        },
        createUser: async (email, password, meta) => {
          assert.equal(email, "new@example.com");
          assert.equal(password, "password1");
          assert.deepEqual(meta, { full_name: "Ada" });
          return { user: created, error: null };
        },
      },
    );
    assert.deepEqual(result, { ok: true, user: created });
  });

  it("signs in when the invite email already has an account", async () => {
    const existing = user("old@example.com");
    const result = await authenticateForInviteEmail(
      { email: "old@example.com", password: "password1" },
      {
        findUserByEmail: async () => ({ id: "u1" }),
        verifyLogin: async (email, password) => {
          assert.equal(email, "old@example.com");
          assert.equal(password, "password1");
          return { ok: true, user: existing };
        },
        createUser: async () => {
          throw new Error("should not register");
        },
      },
    );
    assert.deepEqual(result, { ok: true, user: existing });
  });

  it("rejects a wrong password for an existing account without offering register", async () => {
    const result = await authenticateForInviteEmail(
      { email: "old@example.com", password: "nope" },
      {
        findUserByEmail: async () => ({ id: "u1" }),
        verifyLogin: async () => ({ ok: false, reason: "invalid" }),
        createUser: async () => {
          throw new Error("should not register");
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 401);
    assert.match(result.error, /wrong password/i);
  });

  it("requires an 8+ char password when creating an account", async () => {
    const result = await authenticateForInviteEmail(
      { email: "new@example.com", password: "short" },
      {
        findUserByEmail: async () => null,
        verifyLogin: async () => {
          throw new Error("should not login");
        },
        createUser: async () => {
          throw new Error("should not register");
        },
      },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 400);
    assert.match(result.error, /8 characters/i);
  });
});
