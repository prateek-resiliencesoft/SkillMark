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
      undefined,
      [],
      { title: "Third", n: 3 },
    ],
  });
  assert.deepEqual(out.items, [
    { title: "Good", n: 1 },
    { title: "Also good", n: 0 }, // invalid n → default
    { title: "Third", n: 3 },
  ]);
});

test("softParseProps keeps valid stringList entries", () => {
  const fields: Field[] = [{ kind: "stringList", key: "tags", label: "Tags" }];
  const out = softParseProps(fields, { tags: ["a", 2, "b", null, "c", true, {}] });
  assert.deepEqual(out.tags, ["a", "b", "c"]);
});

test("softParseProps non-array list becomes empty required list", () => {
  const fields: Field[] = [
    {
      kind: "list",
      key: "items",
      label: "Items",
      itemLabel: "Item",
      fields: [{ kind: "text", key: "title", label: "Title" }],
    },
  ];
  assert.deepEqual(softParseProps(fields, { items: "nope" }).items, []);
  assert.deepEqual(softParseProps(fields, {}).items, []);
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

test("strict mode rejects nested unsupported children inside containers", () => {
  const doc = defaultSiteDocument();
  doc.pages[0]!.sections.push({
    id: "custom1",
    type: "custom",
    hidden: false,
    props: {},
    style: {},
    blocks: [
      {
        id: "row1",
        type: "row",
        props: { gap: "sm" },
        style: {},
        children: [
          {
            id: "btn1",
            type: "button",
            props: { label: "Go", href: "/x", variant: "primary", size: "md" },
            style: {},
            // button is not a container — children must be rejected
            children: [
              { id: "ghost", type: "text", props: { text: "x", size: "base", muted: false }, style: {}, children: [] },
            ],
          },
        ],
      },
    ],
  });
  assert.throws(() => validateSectionProps(doc, { strict: true }), /cannot have children/i);
});

test("soft mode strips unsupported children/blocks instead of throwing", () => {
  const doc = defaultSiteDocument();
  const hero = doc.pages[0]!.sections.find((s) => s.type === "hero")!;
  hero.blocks = [{ id: "b1", type: "text", props: { text: "x", size: "base", muted: false }, style: {}, children: [] }];
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
        children: [{ id: "c1", type: "text", props: { text: "nope", size: "base", muted: false }, style: {}, children: [] }],
      },
    ],
  });
  const soft = validateSectionProps(doc, { strict: false });
  const softHero = soft.pages[0]!.sections.find((s) => s.type === "hero")!;
  assert.deepEqual(softHero.blocks, []);
  const custom = soft.pages[0]!.sections.find((s) => s.id === "custom1")!;
  assert.equal(custom.blocks[0]!.type, "heading");
  assert.deepEqual(custom.blocks[0]!.children, []);
});

test("scopeCss accepts flat calc/min/scale/var declarations", () => {
  const sel = ".scoped";
  const accept = (css: string) => assert.equal(scopeCss(sel, css), `${sel}{${css}}`);

  accept("width: calc(100% - 2rem)");
  accept("max-width: min(100%, 40rem)");
  // Valid transform usage — bare `scale(1.2) * 2` is not CSS; multiply inside calc/scale.
  accept("transform: scale(1.2)");
  accept("transform: scale(calc(1.2 * 2))");
  accept("color: var(--brand)");
  accept("color: var(--x, var(--y, #fff))");
  accept("margin: calc(1rem * 2); padding: 1rem");
});

test("scopeCss rejects at-rules, url(), and braced blocks", () => {
  const reject = (css: string) => assert.equal(scopeCss(".x", css), "");

  reject("@media (min-width: 600px)");
  reject("@media screen { color: red }");
  reject("@import url(x.css);");
  reject("@keyframes spin");
  reject("background: url(evil)");
  reject("background: url('https://x.test/a.png')");
  reject("background: URL(\"https://x.test/a.png\")");
  reject("color: red { }");
  reject("color: red { color: blue }");
  reject("h2{color:red}");
  reject("} body{color:red");
  reject("/* { */ } body{color:red}");
  reject('content:"}"; } body{color:red}');
  reject("width: expression(alert(1))");
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
