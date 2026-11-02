/**
 * Guards the organization_members.organizationId rename.
 * Fails loudly if any server helper still queries the legacy workspaceId column.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  "src/server/trpc.ts",
  "src/server/tenant.ts",
  "src/server/quotas.ts",
  "src/server/batch-access.ts",
  "src/server/routers/organization.ts",
  "src/server/routers/orgMember.ts",
  "src/server/routers/platform.ts",
  "src/lib/api-key-auth.ts",
];

describe("organization_members column rename", () => {
  it("does not reference workspaceId in live server paths", () => {
    for (const rel of FILES) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      assert.doesNotMatch(
        src,
        /workspaceId/,
        `${rel} still mentions workspaceId`,
      );
    }
  });

  it("queries organizationId on membership lookups", () => {
    const trpc = readFileSync(path.join(ROOT, "src/server/trpc.ts"), "utf8");
    assert.match(trpc, /\.eq\("organizationId", organizationId\)/);
  });
});
