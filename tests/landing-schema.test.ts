import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsToZod, isSafeHref, softParseProps, type Field } from "../landingpage_connection/shared/fields";
import { defaultSiteDocument } from "../landingpage_connection/shared/defaults";
import { migrateSiteDocument, parseSiteDocument } from "../landingpage_connection/shared/migrate";
import { SCHEMA_VERSION, siteDocumentSchema } from "../landingpage_connection/shared/schema";
import { scopeCss, stripCssNoise } from "../landingpage_connection/shared/style";
import { validateSectionProps } from "../landingpage_connection/shared/validate-props";
import { REBUILD_DEBOUNCE_MS } from "../landingpage_connection/server/rebuild";
import { detectImageMime } from "../landingpage_connection/server/media";

test("default document validates", () => {
  const doc = defaultSiteDocument();
  const result = siteDocumentSchema.safeParse(doc);
  assert.equal(result.success, true);
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(doc.pages.some((p) => p.slug === ""));
  // Strict props validation must accept the defaults.
  assert.doesNotThrow(() => validateSectionProps(doc, { strict: true }));
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

test("strict fieldsToZod rejects unknown keys", () => {
  const fields: Field[] = [{ kind: "text", key: "title", label: "Title" }];
  const loose = fieldsToZod(fields);
  const strict = fieldsToZod(fields, { strict: true });
  const payload = { title: "Hi", extra: "nope" };
  assert.equal(loose.safeParse(payload).success, true); // strips
  assert.equal(strict.safeParse(payload).success, false); // rejects
});

test("isSafeHref allowlists schemes", () => {
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("/about"), true);
  assert.equal(isSafeHref("https://example.com"), true);
  assert.equal(isSafeHref("mailto:a@b.c"), true);
  assert.equal(isSafeHref("{appUrl}"), true);
});

test("migrate falls back to defaults on malformed documents", () => {
  const migrated = migrateSiteDocument({
    schemaVersion: 1,
    pages: [{ id: "x", slug: "!!!bad!!!", title: "X", hidden: false, seo: {}, sections: [] }],
  });
  assert.equal(migrated.pages.some((p) => p.slug === ""), true);
});

test("migrate fills missing keys", () => {
  const migrated = migrateSiteDocument({ schemaVersion: 0, settings: { siteName: "X" } });
  assert.equal(migrated.settings.siteName, "X");
  assert.ok(migrated.settings.contactEmail);
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

test("strict mode rejects unknown section types", () => {
  const doc = defaultSiteDocument();
  doc.pages[0]!.sections.push({
    id: "bogus",
    type: "notARealSection",
    hidden: false,
    props: { foo: 1 },
    style: {},
    blocks: [],
  });
  assert.throws(() => validateSectionProps(doc, { strict: true }), /Unknown section type/);
});

test("strict mode rejects unknown block types", () => {
  const doc = defaultSiteDocument();
  doc.pages[0]!.sections.push({
    id: "custom1",
    type: "custom",
    hidden: false,
    props: {},
    style: {},
    blocks: [{ id: "b1", type: "notABlock", props: {}, style: {}, children: [] }],
  });
  assert.throws(() => validateSectionProps(doc, { strict: true }), /Unknown block type/);
});

test("strict mode rejects unknown props on known presets", () => {
  const doc = defaultSiteDocument();
  const hero = doc.pages[0]!.sections.find((s) => s.type === "hero")!;
  hero.props = { ...hero.props, totallyExtra: true };
  assert.throws(() => validateSectionProps(doc, { strict: true }), /Unrecognized key|Unexpected|totallyExtra/i);
});

test("softParseProps preserves valid fields", () => {
  const fields: Field[] = [
    { kind: "text", key: "title", label: "Title" },
    { kind: "text", key: "subtitle", label: "Subtitle" },
    { kind: "number", key: "n", label: "N" },
  ];
  const out = softParseProps(fields, { title: "Keep me", subtitle: 123, n: 5, junk: true });
  assert.equal(out.title, "Keep me");
  assert.equal(out.n, 5);
  assert.equal(out.subtitle, ""); // invalid → default empty string
  assert.equal("junk" in out, false);
});

test("softParseProps keeps valid list items when one entry is invalid", () => {
  const fields: Field[] = [
    {
      kind: "list",
      key: "items",
      label: "Items",
      itemLabel: "Item",
      fields: [
        { kind: "text", key: "title", label: "Title" },
        { kind: "number", key: "n", label: "N" },
      ],
    },
  ];
  const out = softParseProps(fields, {
    items: [
      { title: "Good", n: 1 },
      "not-an-object",
      { title: "Also good", n: "bad" },
      null,
    ],
  });
  assert.deepEqual(out.items, [
    { title: "Good", n: 1 },
    { title: "Also good", n: 0 }, // invalid n → default
  ]);
});

test("softParseProps keeps valid stringList entries", () => {
  const fields: Field[] = [{ kind: "stringList", key: "tags", label: "Tags" }];
  const out = softParseProps(fields, { tags: ["a", 2, "b", null, "c"] });
  assert.deepEqual(out.tags, ["a", "b", "c"]);
});

test("strict mode rejects children on non-container blocks", () => {
  const doc = defaultSiteDocument();
  doc.pages[0]!.sections.push({
    id: "custom1",
    type: "custom",
    hidden: false,
    props: {},
    style: {},
    blocks: [
      {
        id: "b1",
        type: "heading",
        props: { text: "Hi", level: "h2" },
        style: {},
        children: [{ id: "c1", type: "text", props: { text: "nope" }, style: {}, children: [] }],
      },
    ],
  });
  assert.throws(() => validateSectionProps(doc, { strict: true }), /cannot have children/i);
});

test("strict mode rejects blocks on preset sections", () => {
  const doc = defaultSiteDocument();
  const hero = doc.pages[0]!.sections.find((s) => s.type === "hero")!;
  hero.blocks = [{ id: "b1", type: "text", props: { text: "x" }, style: {}, children: [] }];
  assert.throws(() => validateSectionProps(doc, { strict: true }), /cannot contain blocks/i);
});

test("scopeCss only allows flat declaration lists", () => {
  assert.equal(scopeCss('[data-lp-section="a"]', "color: red; padding: 1rem"), '[data-lp-section="a"]{color: red; padding: 1rem}');
  assert.equal(scopeCss(".x", "h2{color:red}"), "");
  assert.equal(scopeCss(".x", "} body{color:red"), "");
  assert.equal(scopeCss(".x", "h2{color:red"), "");
  assert.equal(scopeCss(".x", "/* { */ } body{color:red}"), "");
  assert.equal(scopeCss(".x", 'content:"}"; } body{color:red}'), "");
  assert.equal(scopeCss(".x", "@import url(x.css);"), "");
  assert.equal(scopeCss(".x", "background: url(evil)"), "");
});

test("stripCssNoise removes comments and strings", () => {
  assert.equal(stripCssNoise("a/* { }*/b"), "ab");
  assert.equal(stripCssNoise('x: "}"'), 'x: ""');
});

test("detectImageMime reads magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageMime(png), "image/png");
});

test("rebuild debounce is 30s", () => {
  assert.equal(REBUILD_DEBOUNCE_MS, 30_000);
});
