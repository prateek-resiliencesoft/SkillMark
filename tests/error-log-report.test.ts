import test from "node:test";
import assert from "node:assert/strict";
import { buildErrorLogReport, type ErrorLogRow, type GroupStatusRow } from "../src/lib/error-log-report";

const FROM = "2026-11-18T00:00:00.000Z";
const TO = "2026-11-19T00:00:00.000Z";
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

function row(over: Partial<ErrorLogRow> & { id: string }): ErrorLogRow {
  return {
    sessionId: "11111111-2222-3333-4444-555555555555",
    createdAt: "2026-11-18T10:00:00.000Z",
    category: "report",
    severity: "error",
    source: "report/generate",
    message: 'Google Gemini rejected request for "gemini-3.5-flash" (400, empty body)',
    status: 400,
    code: null,
    organizationId: ORG_A,
    organizationName: "Org A",
    candidateId: "c1",
    candidateName: "Jigyansh",
    interviewId: "i1",
    interviewTitle: "MERN",
    ...over,
  };
}

const base = { from: FROM, to: TO, filters: {}, statuses: new Map<string, GroupStatusRow>(), page: 0, pageSize: 50, truncated: false };

test("identical errors across orgs and times form one ranked group", () => {
  const rows = [
    row({ id: "1", createdAt: "2026-11-18T10:00:00.000Z" }),
    row({ id: "2", createdAt: "2026-11-18T10:05:00.000Z", candidateId: "c2", candidateName: "Ananya" }),
    row({ id: "3", createdAt: "2026-11-18T12:00:00.000Z", organizationId: ORG_B, organizationName: "Org B", sessionId: "22222222-2222-3333-4444-555555555555" }),
    row({ id: "4", message: "stop recording timed out after 30000ms", category: "client", source: "client", status: null }),
  ];
  const r = buildErrorLogReport(rows, base);
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].count, 3, "most frequent group first");
  assert.equal(r.groups[0].orgCount, 2);
  assert.equal(r.groups[0].candidateCount, 2);
  assert.equal(r.groups[0].sessionCount, 2);
  assert.equal(r.groups[0].topOrgs[0].name, "Org A");
  assert.equal(r.groups[0].topOrgs[0].count, 2);
  assert.equal(r.groups[0].firstSeen, "2026-11-18T10:00:00.000Z");
  assert.equal(r.groups[0].lastSeen, "2026-11-18T12:00:00.000Z");
  assert.equal(r.summary.total, 4);
  assert.equal(r.summary.groups, 2);
  assert.equal(r.summary.orgs, 2);
  assert.equal(r.summary.candidates, 2);
});

test("group severity is the worst seen, and status defaults to open", () => {
  const rows = [row({ id: "1", severity: "warning" }), row({ id: "2", severity: "critical" })];
  const r = buildErrorLogReport(rows, base);
  assert.equal(r.groups[0].severity, "critical");
  assert.equal(r.groups[0].status, "open");
  assert.equal(r.summary.openGroups, 1);
});

test("saved status and note come through; status filter keeps only that group", () => {
  const rows = [row({ id: "1" }), row({ id: "2", message: "other failure", source: "x" })];
  const sig = buildErrorLogReport(rows, base).groups.find((g) => g.sampleMessage.includes("gemini"))!.signature;
  const statuses = new Map<string, GroupStatusRow>([[sig, { status: "acknowledged", note: "model name fix pending", updatedAt: null }]]);
  const r = buildErrorLogReport(rows, { ...base, statuses });
  const g = r.groups.find((x) => x.signature === sig)!;
  assert.equal(g.status, "acknowledged");
  assert.equal(g.note, "model name fix pending");

  const onlyAck = buildErrorLogReport(rows, { ...base, statuses, filters: { status: "acknowledged" } });
  assert.equal(onlyAck.groups.length, 1);
  assert.equal(onlyAck.events.total, 1);
  assert.equal(onlyAck.events.items[0].id, "1");
});

test("org, category and search filters narrow groups, events and summary", () => {
  const rows = [
    row({ id: "1" }),
    row({ id: "2", organizationId: ORG_B, organizationName: "Org B", candidateName: "Ravi" }),
    row({ id: "3", category: "voice", source: "voice-relay", message: "socket closed" }),
  ];
  const byOrg = buildErrorLogReport(rows, { ...base, filters: { organizationId: ORG_B } });
  assert.equal(byOrg.summary.total, 1);
  const byCat = buildErrorLogReport(rows, { ...base, filters: { category: "voice" } });
  assert.equal(byCat.summary.total, 1);
  const bySearch = buildErrorLogReport(rows, { ...base, filters: { search: "ravi" } });
  assert.equal(bySearch.summary.total, 1);
  // Organization options come from the whole range, so the dropdown does not shrink when filtering.
  assert.equal(byOrg.organizations.length, 2);
});

test("hourly buckets for short ranges, daily for longer, and zero-filled", () => {
  const rows = [row({ id: "1", createdAt: "2026-11-18T10:30:00.000Z" }), row({ id: "2", createdAt: "2026-11-18T10:45:00.000Z", category: "voice", source: "v" })];
  const hourly = buildErrorLogReport(rows, base);
  assert.equal(hourly.range.bucket, "hour");
  assert.equal(hourly.series.length, 25);
  const at10 = hourly.series.find((p) => p.t === "2026-11-18T10:00:00.000Z")!;
  assert.equal(at10.total, 2);
  assert.equal(at10.byCategory.report, 1);
  assert.equal(at10.byCategory.voice, 1);

  const daily = buildErrorLogReport(rows, { ...base, from: "2026-11-01T00:00:00.000Z", to: "2026-11-19T00:00:00.000Z" });
  assert.equal(daily.range.bucket, "day");
  assert.equal(daily.series.length, 19);
});

test("events are newest first and paginate", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ id: `e${i}`, createdAt: `2026-11-18T10:0${i}:00.000Z` }));
  const p0 = buildErrorLogReport(rows, { ...base, pageSize: 2, page: 0 });
  assert.equal(p0.events.total, 5);
  assert.deepEqual(p0.events.items.map((e) => e.id), ["e4", "e3"]);
  const p2 = buildErrorLogReport(rows, { ...base, pageSize: 2, page: 2 });
  assert.deepEqual(p2.events.items.map((e) => e.id), ["e0"]);
});

test("missing org and candidate still show up as unknown rows", () => {
  const rows = [row({ id: "1", organizationId: null, organizationName: null, candidateId: null, candidateName: null })];
  const r = buildErrorLogReport(rows, base);
  assert.equal(r.groups[0].topOrgs[0].name, "Unknown organization");
  assert.equal(r.groups[0].topCandidates[0].name, "Unnamed candidate");
  assert.equal(r.groups[0].orgCount, 0);
});
