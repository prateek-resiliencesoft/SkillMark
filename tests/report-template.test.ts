import test from "node:test";
import assert from "node:assert/strict";
import {
  computePageBreaks,
  DEFAULT_REPORT_TEMPLATE,
  MAX_LOGO_DATA_URL_LENGTH,
  moveSection,
  normalizeReportTemplate,
  pageSizeMm,
  REPORT_SECTION_IDS,
  reportTemplateSchema,
} from "../src/lib/report-template";
import { buildReportData, findAnswerExcerpt, recommendationFor, toBullets } from "../src/lib/report-data";

const clone = () => structuredClone(DEFAULT_REPORT_TEMPLATE);

test("default template is valid and has every section once", () => {
  assert.equal(reportTemplateSchema.safeParse(DEFAULT_REPORT_TEMPLATE).success, true);
  assert.deepEqual(DEFAULT_REPORT_TEMPLATE.sections.map((s) => s.id).sort(), [...REPORT_SECTION_IDS].sort());
});

test("schema rejects bad colour, oversize/non-image logo, duplicate sections, font size", () => {
  const bad = (mut: (t: ReturnType<typeof clone>) => void) => {
    const t = clone();
    mut(t);
    return reportTemplateSchema.safeParse(t).success;
  };
  assert.equal(bad((t) => (t.branding.accentColor = "red")), false);
  assert.equal(bad((t) => (t.branding.logoDataUrl = "javascript:alert(1)")), false);
  assert.equal(bad((t) => (t.branding.logoDataUrl = "data:image/png;base64," + "A".repeat(MAX_LOGO_DATA_URL_LENGTH))), false);
  assert.equal(bad((t) => (t.branding.logoDataUrl = "data:image/png;base64,iVBORw0KGgo=")), true);
  assert.equal(bad((t) => (t.sections[1] = { ...t.sections[0] })), false);
  assert.equal(bad((t) => (t.format.fontSize = 40)), false);
  assert.equal(bad((t) => (t.branding.headerText = "x".repeat(121))), false);
});

test("normalize never throws and repairs partial/invalid stored templates", () => {
  assert.deepEqual(normalizeReportTemplate(null), DEFAULT_REPORT_TEMPLATE);
  assert.deepEqual(normalizeReportTemplate({}), DEFAULT_REPORT_TEMPLATE);
  const t = normalizeReportTemplate({
    branding: { accentColor: "nope", headerText: "Acme" },
    sections: [{ id: "questions", enabled: true }, { id: "questions", enabled: false }, { id: "bogus", enabled: true }],
    format: { pageSize: "letter", fontSize: 99 },
  });
  assert.equal(t.branding.accentColor, DEFAULT_REPORT_TEMPLATE.branding.accentColor);
  assert.equal(t.branding.headerText, "Acme");
  assert.equal(t.sections[0].id, "questions");
  assert.equal(t.sections.length, REPORT_SECTION_IDS.length);
  assert.equal(t.sections.filter((s) => s.enabled).length, 1);
  assert.equal(t.format.pageSize, "letter");
  assert.equal(t.format.fontSize, DEFAULT_REPORT_TEMPLATE.format.fontSize);
  assert.equal(reportTemplateSchema.safeParse(t).success, true);
});

test("moveSection reorders and ignores out-of-range moves", () => {
  const s = DEFAULT_REPORT_TEMPLATE.sections;
  assert.equal(moveSection(s, 0, 1)[1].id, s[0].id);
  assert.equal(moveSection(s, 0, -1), s);
  assert.equal(moveSection(s, s.length - 1, 1), s);
});

test("page size and block-aware page breaks", () => {
  assert.deepEqual(pageSizeMm({ ...DEFAULT_REPORT_TEMPLATE.format, orientation: "landscape" }), { width: 297, height: 210 });
  // Cut at the 900 boundary instead of slicing the block that spans 900–1100.
  assert.deepEqual(computePageBreaks(2000, 1000, [400, 900, 1100, 1800]), [[0, 900], [900, 1800], [1800, 2000]]);
  // No usable boundary → hard cut.
  assert.deepEqual(computePageBreaks(2500, 1000, [100]), [[0, 1000], [1000, 2000], [2000, 2500]]);
  assert.deepEqual(computePageBreaks(0, 1000, []), []);
});

test("report data: recommendation, bullets, answer excerpt", () => {
  assert.equal(recommendationFor(8, false), "hire");
  assert.equal(recommendationFor(5.5, false), "maybe");
  assert.equal(recommendationFor(3, false), "no");
  assert.equal(recommendationFor(9, true), "no");
  assert.equal(recommendationFor(null, false), null);
  assert.deepEqual(toBullets("Strong communicator. Needs work on SQL.\nGood energy"), ["Strong communicator.", "Needs work on SQL.", "Good energy"]);
  const msgs = [
    { role: "ASSISTANT", content: "Tell me about a time you led a project under pressure?" },
    { role: "USER", content: "At my last job I led" },
    { role: "USER", content: "the migration." },
    { role: "ASSISTANT", content: "Thanks." },
  ];
  assert.equal(findAnswerExcerpt("Tell me about a time you led a project under pressure", msgs), "At my last job I led the migration.");
  const d = buildReportData({
    status: "DISQUALIFIED",
    insights: { questionEvaluations: [{ question: "Q", score: 8, evaluation: "ok", highlights: ["A"], improvements: [] }] },
    antiCheatingLog: [{ type: "tab_switch" }, { type: "head_movement" }, { type: "paste" }],
    messages: [],
  });
  assert.equal(d.integrityStrikes, 3);
  assert.equal(d.disqualified, true);
  assert.equal(d.recommendation, "no");
  assert.deepEqual(d.strengths, ["A"]);
});
