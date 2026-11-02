import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOrgLimits } from "@/server/quotas";

describe("resolveOrgLimits", () => {
  it("uses free plan defaults", () => {
    assert.deepEqual(resolveOrgLimits("FREE"), {
      seats: 5,
      interviews: 20,
      projects: 3,
    });
  });

  it("treats self-hosted as unlimited", () => {
    assert.deepEqual(resolveOrgLimits("SELF_HOSTED"), {
      seats: null,
      interviews: null,
      projects: null,
    });
  });

  it("applies per-org overrides", () => {
    const limits = resolveOrgLimits("FREE", { seats: 12, interviews: null });
    assert.equal(limits.seats, 12);
    assert.equal(limits.interviews, null);
    assert.equal(limits.projects, 3);
  });

  it("ignores junk override values", () => {
    const limits = resolveOrgLimits("PRO", {
      seats: "nope",
      projects: -1,
    } as Record<string, unknown>);
    assert.equal(limits.seats, 25);
    assert.equal(limits.projects, 20);
  });
});
