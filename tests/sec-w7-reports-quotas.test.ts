/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  boundCodeSnippets,
  boundDrawings,
  boundTranscript,
  SUMMARY_MAX_CODE_CHARS,
  SUMMARY_MAX_DRAWINGS,
  SUMMARY_MAX_TRANSCRIPT_CHARS,
} from "@/lib/ai/summary-bounds";
import { CODE_RUN_LIMITS, codeRunSessionAllowed, createCodeRunLimiter } from "@/server/code-runner/limits";
import { isMonitorPublic, loadUptimeVisibility, seedUptimeVisibilityIfNeeded } from "@/lib/uptime/visibility";

type Call = [string, unknown[]];
const originalFrom = supabaseAdmin.from;
afterEach(() => {
  (supabaseAdmin as any).from = originalFrom;
});

/** Chainable PostgREST stand-in: records every builder call, resolves via `answer`. */
function installDb(answer: (table: string, calls: Call[]) => unknown) {
  const log: { table: string; calls: Call[] }[] = [];
  (supabaseAdmin as any).from = (table: string) => {
    const calls: Call[] = [];
    log.push({ table, calls });
    const b: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (res: any, rej: any) => Promise.resolve(answer(table, calls)).then(res, rej);
          return (...args: unknown[]) => {
            calls.push([String(prop), args]);
            return b;
          };
        },
      },
    );
    return b;
  };
  return log;
}

const has = (calls: Call[], m: string, arg?: string) => calls.some(([n, a]) => n === m && (arg === undefined || String(a[0]).includes(arg)));

describe("summary prompt bounds", () => {
  it("caps transcript, code and drawings regardless of how much the candidate stored", () => {
    const transcript = Array.from({ length: 5000 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", content: "x".repeat(3000) }));
    const t = boundTranscript(transcript);
    assert.ok(t.reduce((n, m) => n + m.content.length, 0) <= SUMMARY_MAX_TRANSCRIPT_CHARS + 200);
    assert.match(t.find((m) => m.content.includes("omitted"))!.content, /messages omitted/);
    assert.equal(boundTranscript([{ role: "user", content: "hi" }]).length, 1);

    const code = boundCodeSnippets(Array.from({ length: 500 }, () => ({ code: "y".repeat(50_000) })));
    assert.ok(code.reduce((n, s) => n + s.code.length, 0) <= SUMMARY_MAX_CODE_CHARS);

    const drawings = boundDrawings(
      Array.from({ length: 200 }, (_, i) => ({ imageDataUrl: i === 199 ? "data:image/svg+xml;base64," + "A".repeat(3 * 1024 * 1024) : "data:image/svg+xml;base64,AA" })),
    );
    assert.equal(drawings.length, SUMMARY_MAX_DRAWINGS);
    assert.equal(drawings.at(-1)!.imageDataUrl, null);
  });
});

describe("report sweeper", () => {
  it("filters terminal rows in SQL and does not block on slow report runs", async () => {
    const pending = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, status: "COMPLETED", summary: null, insights: null, reportStatus: "PENDING", reportAttempts: 0 }));
    const log = installDb((table, calls) => {
      if (table === "sessions" && has(calls, "in", "status")) return { data: pending, error: null };
      if (table === "sessions" && has(calls, "maybeSingle")) {
        const id = calls.find(([n, a]) => n === "eq" && a[0] === "id")?.[1][1];
        return { data: pending.find((p) => p.id === id) ?? null, error: null };
      }
      if (table === "messages") return new Promise(() => {}); // a report run that never finishes
      return { data: [], error: null };
    });
    const { sweepPendingReports, MAX_CONCURRENT_REPORTS } = await import("@/lib/session-report-server");

    const started = Date.now();
    const summary = await sweepPendingReports();
    assert.ok(Date.now() - started < 5000, "sweep returned without waiting for report generation");
    assert.equal(summary.reports, MAX_CONCURRENT_REPORTS);

    const q = log.find((l) => l.table === "sessions" && has(l.calls, "in", "status"))!;
    assert.ok(has(q.calls, "or", "reportStatus.in.(PENDING,GENERATING,FAILED)"));
    assert.ok(has(q.calls, "or", "reportAttempts.lt."));
    const limitIdx = q.calls.findIndex(([n]) => n === "limit");
    assert.ok(q.calls.findIndex(([n]) => n === "or") < limitIdx);
  });

  it("a hung report run times out instead of running forever", async () => {
    installDb((table) => (table === "sessions" ? new Promise(() => {}) : { data: [], error: null }));
    const { runReportWithTimeout } = await import("@/lib/session-report-server");
    await assert.rejects(() => runReportWithTimeout("s-hung", 50), /timed out/);
  });
});

describe("code.run quotas", () => {
  it("rotating session ids cannot reset the org / global budget", () => {
    const limiter = createCodeRunLimiter({ ...CODE_RUN_LIMITS, maxConcurrent: 1000 });
    let ok = 0;
    for (let i = 0; i < 500; i++) {
      const r = limiter.acquire({ sessionId: `session-${i}`, organizationId: "org-1" });
      if (r.ok) {
        ok++;
        r.release();
      }
    }
    assert.equal(ok, CODE_RUN_LIMITS.perOrgPerMinute);

    const other = createCodeRunLimiter({ ...CODE_RUN_LIMITS, maxConcurrent: 1000 });
    let total = 0;
    for (let i = 0; i < 500; i++) if (other.acquire({ sessionId: `s-${i}`, organizationId: `org-${i}` }).ok) total++;
    assert.equal(total, CODE_RUN_LIMITS.globalPerMinute);
  });

  it("a signed-in user switching session ids keeps the per-user budget", () => {
    const limiter = createCodeRunLimiter({ ...CODE_RUN_LIMITS, maxConcurrent: 1000 });
    let ok = 0;
    for (let i = 0; i < 50; i++) if (limiter.acquire({ sessionId: `s-${i}`, userId: "u1" }).ok) ok++;
    assert.equal(ok, CODE_RUN_LIMITS.perUserPerMinute);
  });

  it("caps concurrency and frees slots on release", () => {
    const limiter = createCodeRunLimiter({ ...CODE_RUN_LIMITS, maxConcurrent: 2 });
    const a = limiter.acquire({ userId: "a" });
    const b = limiter.acquire({ userId: "b" });
    const c = limiter.acquire({ userId: "c" });
    assert.ok(a.ok && b.ok && !c.ok);
    a.release();
    assert.ok(limiter.acquire({ userId: "c" }).ok);
  });

  it("only begun, in-progress sessions qualify", () => {
    assert.equal(codeRunSessionAllowed({ id: "s", status: "IN_PROGRESS", interviewBeganAt: null }), false);
    assert.equal(codeRunSessionAllowed({ id: "s", status: "COMPLETED", interviewBeganAt: "2026-01-01" }), false);
    assert.equal(codeRunSessionAllowed({ id: "s", status: "IN_PROGRESS", interviewBeganAt: "2026-01-01" }), true);
  });
});

describe("uptime visibility fails closed", () => {
  it("the /admin heuristic never makes a monitor public", () => {
    assert.equal(isMonitorPublic(7, true, { publicIds: [], seeded: false }), false);
    assert.equal(isMonitorPublic(7, false, { publicIds: [7], seeded: true }), true);
  });

  it("missing settings mean nothing public; read errors throw", async () => {
    installDb(() => ({ data: null, error: null }));
    assert.deepEqual(await loadUptimeVisibility(), { publicIds: [], seeded: true });
    installDb(() => ({ data: null, error: { message: "db down" } }));
    await assert.rejects(() => loadUptimeVisibility(), /db down/);
  });

  it("first admin write does not persist heuristic (non-/admin) monitors", async () => {
    const log = installDb(() => ({ data: null, error: null }));
    const vis = await seedUptimeVisibilityIfNeeded([1, 2, 3], "admin");
    assert.deepEqual(vis.publicIds, []);
    assert.ok(!log.some((l) => has(l.calls, "upsert")));
  });
});
