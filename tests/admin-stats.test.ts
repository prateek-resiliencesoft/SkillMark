import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpuPercent,
  dailySeries,
  dayKey,
  levelFor,
  parseCgroupLimit,
  parseMeminfo,
  parseProcStatCpu,
  statusBreakdown,
  usageByOrg,
} from "../src/lib/admin-stats";
import { lokiErrorMessage, parseDsQueryFrames, parseLokiProxy } from "../src/lib/grafana/client";

test("dayKey respects the time zone", () => {
  assert.equal(dayKey("2026-11-12T20:00:00Z", "UTC"), "2026-11-12");
  assert.equal(dayKey("2026-11-12T20:00:00Z", "Asia/Kolkata"), "2026-11-13");
});

test("dailySeries zero-fills and counts completed", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  const s = dailySeries(
    [
      { createdAt: "2026-11-13T08:00:00Z", status: "COMPLETED" },
      { createdAt: "2026-11-13T09:00:00Z", status: "ABANDONED" },
      { createdAt: "2026-11-11T09:00:00Z", status: "COMPLETED" },
      { createdAt: "2026-10-01T09:00:00Z", status: "COMPLETED" },
    ],
    3,
    now,
    "UTC",
  );
  assert.deepEqual(s, [
    { day: "2026-11-11", sessions: 1, completed: 1 },
    { day: "2026-11-12", sessions: 0, completed: 0 },
    { day: "2026-11-13", sessions: 2, completed: 1 },
  ]);
});

test("statusBreakdown always lists the four statuses", () => {
  const b = statusBreakdown([{ status: "COMPLETED" }, { status: "COMPLETED" }, { status: "IN_PROGRESS" }]);
  assert.deepEqual(
    Object.fromEntries(b.map((x) => [x.status, x.count])),
    { IN_PROGRESS: 1, COMPLETED: 2, ABANDONED: 0, DISQUALIFIED: 0 },
  );
});

test("usageByOrg groups by organization and sorts", () => {
  const rows = [
    { interviewId: "i1", status: "COMPLETED" },
    { interviewId: "i2", status: "ABANDONED" },
    { interviewId: "i2", status: "COMPLETED" },
    { interviewId: "gone", status: "COMPLETED" },
  ];
  const out = usageByOrg(rows, { i1: "a", i2: "b" }, { a: "Acme", b: "Beta" });
  assert.deepEqual(out, [
    { id: "b", name: "Beta", sessions: 2, completed: 1 },
    { id: "a", name: "Acme", sessions: 1, completed: 1 },
  ]);
});

test("/proc parsing", () => {
  const mem = parseMeminfo("MemTotal:       2000 kB\nMemAvailable:    500 kB\nHugePages_Total:       0\n");
  assert.equal(mem.MemTotal, 2000 * 1024);
  assert.equal(mem.MemAvailable, 500 * 1024);
  assert.equal(mem.HugePages_Total, 0);

  const a = parseProcStatCpu("cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n")!;
  const b = parseProcStatCpu("cpu  200 0 200 800 100 0 0 0 0 0\n")!;
  assert.deepEqual(a, { idle: 800, total: 1000 });
  assert.equal(cpuPercent(a, b), (200 / 300) * 100);
  assert.equal(cpuPercent(a, a), null);
  assert.equal(parseProcStatCpu("nothing"), null);

  assert.equal(parseCgroupLimit("max\n"), null);
  assert.equal(parseCgroupLimit("1048576\n"), 1048576);
  assert.equal(parseCgroupLimit("9223372036854771712"), null);
  assert.equal(parseCgroupLimit(null), null);

  assert.equal(levelFor(null), "ok");
  assert.equal(levelFor(80), "warn");
  assert.equal(levelFor(95), "critical");
});

test("Loki proxy and /api/ds/query responses parse to the same entries", () => {
  const proxy = parseLokiProxy({
    data: {
      result: [
        {
          stream: { filename: "/var/log/syslog", instance: "skillmark", job: "integrations/node_exporter" },
          values: [["1763000000000000000", "kernel: ERROR something"]],
        },
      ],
    },
  });
  assert.equal(proxy.length, 1);
  assert.equal(proxy[0].level, "error");

  const frames = parseDsQueryFrames({
    results: {
      A: {
        frames: [
          {
            schema: {
              fields: [
                { name: "labels", type: "other" },
                { name: "Time", type: "time" },
                { name: "Line", type: "string" },
                { name: "tsNs", type: "string" },
              ],
            },
            data: {
              values: [
                [{ filename: "/var/log/syslog", instance: "skillmark", job: "integrations/node_exporter" }],
                [1763000000000],
                ["kernel: ERROR something"],
                ["1763000000000000000"],
              ],
            },
          },
        ],
      },
    },
  });
  assert.deepEqual(frames, proxy);

  // Older frame shape: labels on the line field, no tsNs.
  const old = parseDsQueryFrames({
    results: {
      A: {
        frames: [
          {
            schema: {
              fields: [
                { name: "Time", type: "time" },
                { name: "Line", type: "string", labels: { filename: "/var/log/auth.log" } },
              ],
            },
            data: { values: [[1763000000000], ["sshd: WARNING x"]] },
          },
        ],
      },
    },
  });
  assert.equal(old[0].filename, "/var/log/auth.log");
  assert.equal(old[0].level, "warn");
});

test("lokiErrorMessage explains the 503 without leaking anything else", () => {
  const msg = lokiErrorMessage(
    ['proxy grafanacloud-logs: 503 {"code":"DatasourceError","message":"There was an issue communicating with your datasource."}'],
    "grafanacloud-logs",
  );
  assert.match(msg, /could not reach its Loki datasource/);
  assert.match(lokiErrorMessage(["proxy x: 403 forbidden"], "x"), /permission/);
  assert.match(lokiErrorMessage(["proxy x: 404 not found"], "x"), /GRAFANA_LOKI_DATASOURCE_UID/);
});
