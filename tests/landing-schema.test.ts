import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsToZod, isSafeHref, type Field } from "../landingpage_connection/shared/fields";
import { defaultSiteDocument } from "../landingpage_connection/shared/defaults";
import { migrateSiteDocument, parseSiteDocument } from "../landingpage_connection/shared/migrate";
import { SCHEMA_VERSION, siteDocumentSchema } from "../landingpage_connection/shared/schema";
import { scopeCss } from "../landingpage_connection/shared/style";
import { REBUILD_DEBOUNCE_MS } from "../landingpage_connection/server/rebuild";

test("default document validates", () => {
  const doc = defaultSiteDocument();
  const result = siteDocumentSchema.safeParse(doc);
  assert.equal(result.success, true);
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(doc.pages.some((p) => p.slug === ""));
});

test("fieldsToZod builds props schema", () => {
  const fields: Field[] = [
    { kind: "text", key: "title", label: "Title" },
    { kind: "boolean", key: "on", label: "On" },
    { kind: "stringList", key: "tags", label: "Tags" },
  ];
  const schema = fieldsToZod(fields);
  assert.equal(schema.safeParse({ title: "Hi", on: true, tags: ["a"] }).success, true);
  assert.equal(schema.safeParse({ title: "Hi", on: "no", tags: [] }).success, false);
});

test("isSafeHref blocks javascript:", () => {
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("/about"), true);
  assert.equal(isSafeHref("https://example.com"), true);
  assert.equal(isSafeHref("mailto:a@b.c"), true);
});

test("migrate fills missing keys", () => {
  const migrated = migrateSiteDocument({ schemaVersion: 0, settings: { siteName: "X" } });
  assert.equal(migrated.settings.siteName, "X");
  assert.ok(migrated.settings.contactEmail);
  assert.ok(migrated.pages.length >= 1);
});

test("parseSiteDocument reports path on error", () => {
  assert.throws(
    () =>
      parseSiteDocument({
        schemaVersion: 1,
        settings: defaultSiteDocument().settings,
        nav: defaultSiteDocument().nav,
        footer: defaultSiteDocument().footer,
        pages: [
          {
            id: "home",
            slug: "!!!",
            title: "Home",
            hidden: false,
            seo: { title: "", description: "" },
            sections: [],
          },
        ],
      }),
    /slug/i,
  );
});

test("scopeCss strips angle brackets and wraps selector", () => {
  assert.equal(scopeCss('[data-lp-section="a"]', "h2{color:red}"), '[data-lp-section="a"]{h2{color:red}}');
  assert.equal(scopeCss(".x", "a</style><script>"), ".x{a/style>script>}");
});

test("rebuild debounce is 30s", () => {
  assert.equal(REBUILD_DEBOUNCE_MS, 30_000);
});
