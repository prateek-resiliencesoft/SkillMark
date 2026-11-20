/**
 * W4 recheck: SKILLMARK-AUTH-JWT-CROSS-PURPOSE-CONFUSION and
 * SKILLMARK-AUTH-STATELESS-JWT-NO-REVOCATION.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { SignJWT } from "jose";
import { FAKE_POSTGREST_URL, installFakePostgrest, type FakePostgrest } from "./sec-w4-fake-postgrest";

process.env.AUTH_SECRET = "w4-test-auth-secret-0123456789abcdef";
process.env.POSTGREST_URL = FAKE_POSTGREST_URL;

type Users = typeof import("@/lib/users");
type AuthSession = typeof import("@/lib/auth-session");
type Preview = typeof import("../landingpage_connection/server/preview-token");

let users: Users;
let session: AuthSession;
let preview: Preview;
let db: FakePostgrest;

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const adminRow = () => ({
  id: ADMIN_ID,
  email: "admin@example.com",
  encrypted_password: "$2a$10$abcdefghijklmnopqrstuuJ3S2kq8Qe8hQXx0oX1o9q9xYb9QK1e2",
  raw_user_meta_data: {},
  created_at: "2026-01-01T00:00:00Z",
  paused_at: null,
  deleted_at: null,
  token_version: 0,
});

before(async () => {
  session = await import("@/lib/auth-session");
  users = await import("@/lib/users");
  preview = await import("../landingpage_connection/server/preview-token");
});

beforeEach(() => {
  db?.restore();
  db = installFakePostgrest({ "auth.users": [adminRow()] });
});

after(() => db?.restore());

const rawSecret = () => new TextEncoder().encode(process.env.AUTH_SECRET!);

describe("session JWTs are isolated from other AUTH_SECRET tokens", () => {
  it("rejects a landing preview token presented as a session (exploit path)", async () => {
    const token = await preview.signPreviewToken(ADMIN_ID, 60);
    assert.deepEqual(await preview.verifyPreviewToken(token), { userId: ADMIN_ID });
    assert.equal(await session.verifySession(token), null);
    assert.equal(await users.getUserFromToken(token), null);
  });

  it("rejects an old-style preview token signed directly with AUTH_SECRET", async () => {
    const legacyPreview = await new SignJWT({ purpose: "landing-preview", sub: ADMIN_ID })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(rawSecret());
    assert.equal(await session.verifySession(legacyPreview), null);
    assert.equal(await users.getUserFromToken(legacyPreview), null);
  });

  it("rejects any AUTH_SECRET JWT that only carries a subject", async () => {
    const bare = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(ADMIN_ID).setExpirationTime("10m").sign(rawSecret());
    assert.equal(await session.verifySession(bare), null);
  });

  it("preview tokens are not signed with the raw session key", async () => {
    const token = await preview.signPreviewToken(ADMIN_ID, 60);
    const { jwtVerify } = await import("jose");
    await assert.rejects(() => jwtVerify(token, rawSecret(), { algorithms: ["HS256"] }));
  });

  it("accepts freshly issued session tokens", async () => {
    const user = (await users.getUserById(ADMIN_ID))!;
    const token = await users.issueSessionToken(user);
    const verified = await session.verifySession(token);
    assert.equal(verified?.id, ADMIN_ID);
    assert.equal((await users.getUserFromToken(token))?.id, ADMIN_ID);
  });

  it("keeps existing login cookies (pre-purpose session shape) working", async () => {
    const legacy = await new SignJWT({ email: "admin@example.com", role: "authenticated", user_metadata: {} })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ADMIN_ID)
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(rawSecret());
    assert.equal((await users.getUserFromToken(legacy))?.id, ADMIN_ID);
  });
});

describe("session revocation via token_version", () => {
  it("password change revokes every earlier session token", async () => {
    const user = (await users.getUserById(ADMIN_ID))!;
    const stolen = await users.issueSessionToken(user);
    assert.ok(await users.getUserFromToken(stolen));

    const { error, tokenVersion } = await users.updatePassword(ADMIN_ID, "new-password-123");
    assert.equal(error, null);
    assert.equal(tokenVersion, 1);
    assert.equal(db.tables["auth.users"][0].token_version, 1);

    assert.equal(await users.getUserFromToken(stolen), null);
    const fresh = await users.issueSessionToken(user);
    assert.equal((await users.getUserFromToken(fresh))?.id, ADMIN_ID);
  });

  it("legacy tokens without a version die on the first bump", async () => {
    const legacy = await new SignJWT({ email: "admin@example.com", role: "authenticated", user_metadata: {} })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ADMIN_ID)
      .setExpirationTime("30d")
      .sign(rawSecret());
    assert.ok(await users.getUserFromToken(legacy));
    const r = await users.bumpTokenVersion(ADMIN_ID);
    assert.deepEqual(r, { version: 1, error: null });
    assert.equal(await users.getUserFromToken(legacy), null);
  });

  it("sign-out-everywhere (bumpTokenVersion) revokes outstanding tokens", async () => {
    const user = (await users.getUserById(ADMIN_ID))!;
    const a = await users.issueSessionToken(user);
    const b = await users.issueSessionToken(user);
    await users.bumpTokenVersion(ADMIN_ID);
    assert.equal(await users.getUserFromToken(a), null);
    assert.equal(await users.getUserFromToken(b), null);
  });

  it("a forged higher tv does not help without the signing key", async () => {
    const forged = await new SignJWT({ email: "admin@example.com", role: "authenticated", purpose: "auth-session", tv: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ADMIN_ID)
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("some-other-secret-0123456789abcdef"));
    assert.equal(await users.getUserFromToken(forged), null);
  });
});
