import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  signPreviewToken,
  verifyPreviewToken,
} from "../landingpage_connection/server/preview-token";

const PREV = process.env.AUTH_SECRET;

before(() => {
  process.env.AUTH_SECRET = "test-auth-secret-with-at-least-32-chars!!";
});

after(() => {
  if (PREV === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = PREV;
});

test("preview token round-trips", async () => {
  const token = await signPreviewToken("user-123", 60);
  const verified = await verifyPreviewToken(token);
  assert.deepEqual(verified, { userId: "user-123" });
});

test("preview token rejects garbage", async () => {
  assert.equal(await verifyPreviewToken("not.a.jwt"), null);
});

test("preview token fails closed without AUTH_SECRET", async () => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  await assert.rejects(() => signPreviewToken("user-123"), /AUTH_SECRET/);
  process.env.AUTH_SECRET = saved;
});
