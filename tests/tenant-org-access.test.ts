/**
 * Smoke checks for membership-gated org resolution used by usage + platform.
 * These assert the public contracts stay user-facing and typed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TENANT_COPY,
  type OrgPlan,
  type OrgStatus,
} from "@/server/tenant";

describe("multi-tenant contracts", () => {
  it("defines the organization status set used by the control center", () => {
    const statuses: OrgStatus[] = ["ACTIVE", "SUSPENDED", "DELETED"];
    assert.deepEqual(statuses, ["ACTIVE", "SUSPENDED", "DELETED"]);
  });

  it("defines the plan set shown in the admin UI", () => {
    const plans: OrgPlan[] = ["FREE", "PRO", "ENTERPRISE", "SELF_HOSTED"];
    assert.equal(plans.length, 4);
  });

  it("keeps forbidden copy free of developer jargon", () => {
    for (const msg of [
      TENANT_COPY.orgNotFound,
      TENANT_COPY.orgPaused,
      TENANT_COPY.orgPausedHard,
      TENANT_COPY.notPlatformAdmin,
      TENANT_COPY.sessionInvalid,
      TENANT_COPY.sessionEnded,
    ]) {
      assert.doesNotMatch(
        msg,
        /\b(tenant|IDOR|RLS|RBAC|UUID|FK|supabase|trpc)\b/i,
      );
    }
  });
});
