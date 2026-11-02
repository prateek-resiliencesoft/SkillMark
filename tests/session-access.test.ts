import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertActiveInterviewSession } from "@/lib/session-access";
import { TENANT_COPY } from "@/server/tenant";

describe("assertActiveInterviewSession", () => {
  it("rejects missing session id without hitting the database", async () => {
    const result = await assertActiveInterviewSession(undefined, "interview-1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, TENANT_COPY.sessionInvalid);
    }
  });

  it("rejects missing interview id", async () => {
    const result = await assertActiveInterviewSession("session-1", "");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
    }
  });
});

describe("tenant copy", () => {
  it("exposes plain-language pause messaging", () => {
    assert.match(TENANT_COPY.orgPaused, /paused/i);
    assert.doesNotMatch(TENANT_COPY.orgPaused, /tenant|suspend|IDOR/i);
    assert.doesNotMatch(TENANT_COPY.notPlatformAdmin, /RBAC|super.?admin|platformProcedure/i);
  });
});
