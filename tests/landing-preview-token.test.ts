import assert from "node:assert/strict";
import { test } from "node:test";
import {
  signPreviewToken,
  verifyPreviewToken,
} from "../landingpage_connection/server/preview-token";

test("preview token round-trips", async () => {
  const token = await signPreviewToken("user-123", 60);
  const verified = await verifyPreviewToken(token);
  assert.deepEqual(verified, { userId: "user-123" });
});

test("preview token rejects garbage", async () => {
  assert.equal(await verifyPreviewToken("not.a.jwt"), null);
});
