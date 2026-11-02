import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminActionLabel } from "@/lib/admin-actions";

describe("adminActionLabel", () => {
  it("maps known platform actions to plain copy", () => {
    assert.equal(adminActionLabel("org.pause"), "Paused an organization");
    assert.equal(adminActionLabel("org.delete"), "Removed an organization");
    assert.equal(
      adminActionLabel("user.set_platform_role"),
      "Changed platform access",
    );
  });

  it("falls back for unknown actions", () => {
    assert.equal(adminActionLabel("custom.thing"), "custom thing");
  });
});
