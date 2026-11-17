import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { defaultSiteDocument } from "../landingpage_connection/shared/defaults";

/** Mirrors the public endpoint body shape without spinning up Next. */
test("public landing payload shape", () => {
  const document = defaultSiteDocument();
  const body = {
    data: document,
    meta: { version: 0, publishedAt: null as string | null },
  };
  assert.equal(typeof body.data.schemaVersion, "number");
  assert.ok(Array.isArray(body.data.pages));
  assert.equal(body.data.settings.siteName.length > 0, true);
  const etag = `"${createHash("sha1").update(JSON.stringify(body.data)).digest("hex").slice(0, 16)}"`;
  assert.match(etag, /^"[a-f0-9]{16}"$/);
});
