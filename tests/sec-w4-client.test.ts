/**
 * W4 recheck: SKILLMARK-CLIENT-OPEN-REDIRECT-NEXT and
 * SKILLMARK-CLIENT-SESSIONSTORAGE-APIKEY-PERSISTENCE.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { safeNextPath } from "@/lib/safe-next";

const ORIGIN = "https://app.example.com";

/** What the browser does with `window.location.href = next` on our origin. */
const resolvedOrigin = (next: string) => new URL(next, `${ORIGIN}/login`).origin;

describe("safeNextPath", () => {
  const attacks = [
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/%5Cevil.com",
    "/./\\evil.com",
    "\\\\evil.com",
    "evil.com",
    "",
  ];

  for (const raw of attacks) {
    it(`never leaves the origin for ${JSON.stringify(raw)}`, () => {
      const out = safeNextPath(raw);
      assert.equal(resolvedOrigin(out), ORIGIN);
      assert.ok(out.startsWith("/") && !out.startsWith("//"));
    });
  }

  it("the old prefix check accepted the backslash payload that browsers send off-site", () => {
    const raw = "/\\evil.com";
    const oldCheck = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://");
    assert.equal(oldCheck, true);
    assert.equal(resolvedOrigin(raw), "https://evil.com");
    assert.equal(safeNextPath(raw), "/dashboard");
  });

  it("keeps legitimate in-app destinations", () => {
    assert.equal(safeNextPath("/interviews/abc?tab=results#top"), "/interviews/abc?tab=results#top");
    assert.equal(safeNextPath("/invite/tok_123"), "/invite/tok_123");
    assert.equal(safeNextPath(null), "/dashboard");
    assert.equal(safeNextPath("//evil.com", ""), "");
  });

  it("is the only next-path guard used by the auth entry points", () => {
    for (const f of [
      "src/components/auth/auth-split-view.tsx",
      "src/components/org-picker.tsx",
      "src/middleware.ts",
      "src/app/api/auth/session-expired/route.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      assert.match(src, /safeNextPath/, f);
      assert.doesNotMatch(src, /startsWith\(["']\/\/["']\)/, `${f} still has an ad-hoc prefix check`);
    }
  });
});

describe("API reference key storage", () => {
  it("never persists the developer API key in web storage", () => {
    const src = readFileSync("src/components/developers/api-reference.tsx", "utf8");
    assert.doesNotMatch(src, /(sessionStorage|localStorage)\.(setItem|getItem)/);
    assert.match(src, /sessionStorage\.removeItem\(LEGACY_KEY_STORE\)/);
  });

  it("sign-out clears any key persisted by older builds", () => {
    const src = readFileSync("src/components/layout/sidebar.tsx", "utf8");
    assert.match(src, /sessionStorage\.removeItem\("rsi-docs-key"\)/);
  });
});
