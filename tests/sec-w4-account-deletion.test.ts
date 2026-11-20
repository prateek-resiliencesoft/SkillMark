/**
 * W4 recheck: SKILLMARK-AUTH-DELETE-ACCOUNT-RESERVED-EMAIL-BYPASS.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { FAKE_POSTGREST_URL, installFakePostgrest, type FakePostgrest } from "./sec-w4-fake-postgrest";

process.env.AUTH_SECRET = "w4-test-auth-secret-0123456789abcdef";
process.env.POSTGREST_URL = FAKE_POSTGREST_URL;

const VICTIM = "44444444-4444-4444-8444-444444444444";
const OTHER_ADMIN = "55555555-5555-4555-8555-555555555555";
const ATTACKER = "66666666-6666-4666-8666-666666666666";
const PREDICTABLE = `deleted+${VICTIM}@deleted.invalid`;

let users: typeof import("@/lib/users");
let deletion: typeof import("@/lib/account-deletion");
let register: (typeof import("@/app/api/auth/register/route"))["POST"];
let db: FakePostgrest;

before(async () => {
  users = await import("@/lib/users");
  deletion = await import("@/lib/account-deletion");
  ({ POST: register } = await import("@/app/api/auth/register/route"));
});

const authRow = (id: string, email: string) => ({
  id,
  email,
  encrypted_password: "$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z0xYzS1F3sT3kZQ0ZQ0ZQ0ZQ",
  raw_user_meta_data: {},
  created_at: "2026-01-01T00:00:00Z",
  paused_at: null,
  deleted_at: null,
  token_version: 0,
});

beforeEach(() => {
  db?.restore();
  db = installFakePostgrest(
    {
      "auth.users": [authRow(VICTIM, "victim@example.com"), authRow(OTHER_ADMIN, "ops@example.com"), authRow(ATTACKER, PREDICTABLE)],
      "public.profiles": [
        { id: VICTIM, email: "victim@example.com", name: "Victim", role: "ADMIN", createdAt: "2026-01-01" },
        { id: OTHER_ADMIN, email: "ops@example.com", name: "Ops", role: "ADMIN", createdAt: "2026-01-01" },
        { id: ATTACKER, email: PREDICTABLE, name: null, role: "USER", createdAt: "2026-01-01" },
      ],
      "public.organizations": [{ id: "org-1", ownerId: VICTIM, name: "Acme", slug: "acme", plan: "free", status: "ACTIVE" }],
      "public.organization_members": [{ id: "m1", organizationId: "org-1", userId: VICTIM, role: "OWNER" }],
      "public.api_keys": [{ id: "k1", userId: VICTIM }],
    },
    { unique: { "auth.users": ["email"], "public.profiles": ["email"] } },
  );
});

after(() => db?.restore());

describe("reserved tombstone emails", () => {
  it("POST /api/auth/register rejects @deleted.invalid addresses", async () => {
    const res = await register(
      new Request("https://app.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "192.0.2.1" },
        body: JSON.stringify({ email: `deleted+${VICTIM}@Deleted.Invalid`, password: "password123" }),
      }),
    );
    assert.equal(res.status, 400);
    assert.equal(db.tables["auth.users"].length, 3);
  });

  it("createUser rejects any .invalid domain", async () => {
    const r = await users.createUser(`deleted+${VICTIM}@deleted.invalid`, "password123");
    assert.equal(r.user, null);
    assert.ok(users.isReservedEmail("x@foo.invalid"));
    assert.ok(!users.isReservedEmail("x@invalid.example.com"));
  });
});

describe("deleteAccount with a pre-registered look-alike tombstone", () => {
  it("still scrubs credentials, sessions and the platform ADMIN role", async () => {
    const user = (await users.getUserById(VICTIM))!;
    const session = await users.issueSessionToken(user);
    assert.ok(await users.getUserFromToken(session));

    const result = await deletion.deleteAccount(VICTIM, { deletedBy: VICTIM });
    assert.deepEqual(result, { ok: true });

    const authVictim = db.tables["auth.users"].find((r) => r.id === VICTIM)!;
    assert.ok(authVictim.deleted_at, "deleted_at must be set");
    assert.equal(authVictim.encrypted_password, "!deleted");
    assert.notEqual(authVictim.email, PREDICTABLE);
    assert.match(authVictim.email, /@deleted\.invalid$/);

    const profile = db.tables["public.profiles"].find((r) => r.id === VICTIM)!;
    assert.equal(profile.role, "USER");
    assert.match(profile.email, /@deleted\.invalid$/);

    assert.equal(await users.getUserFromToken(session), null);
    const login = await users.verifyLogin("victim@example.com", "anything");
    assert.equal(login.ok, false);
    assert.equal(db.tables["public.organization_members"].length, 0);
    assert.equal(db.tables["public.api_keys"].length, 0);
    assert.equal(db.tables["public.organizations"][0].status, "DELETED");
  });

  it("locks the account before cleanup, and reports a failed cleanup step", async () => {
    // A fake UNIQUE(name) makes the final profile update (name: null) fail: the call reports
    // an error, but the account was already locked first.
    db.restore();
    db = installFakePostgrest(
      {
        "auth.users": [authRow(VICTIM, "victim@example.com"), authRow(OTHER_ADMIN, "ops@example.com")],
        "public.profiles": [
          { id: VICTIM, email: "victim@example.com", name: "Victim", role: "ADMIN", createdAt: "2026-01-01" },
          { id: OTHER_ADMIN, email: "ops@example.com", name: null, role: "ADMIN", createdAt: "2026-01-01" },
        ],
      },
      { unique: { "public.profiles": ["name"] } },
    );
    const result = await deletion.deleteAccount(VICTIM, { deletedBy: VICTIM });
    assert.equal(result.ok, false);
    assert.ok(db.tables["auth.users"].find((r) => r.id === VICTIM)!.deleted_at);
    assert.equal(await users.getUserById(VICTIM), null);
  });
});
