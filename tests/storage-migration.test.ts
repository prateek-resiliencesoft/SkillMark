import assert from "node:assert/strict";
import test from "node:test";

import {
  preflightMigration,
  runMigration,
  verifyMigration,
  type MigrationDeps,
  type MigrationState,
} from "@/server/storage-migration";

const CAP_MSG =
  "S3 read failed (403): AccessDenied — Cannot download file, download bandwidth or transaction (Class B) cap exceeded.";

function fakeDeps(source: Record<string, string>, opts: {
  local?: Record<string, string>;
  failReads?: Record<string, number>;
  capAfter?: number;
  corrupt?: Record<string, number>;
  diskFree?: number | null;
  listError?: string;
} = {}) {
  const local = new Map<string, Buffer>(Object.entries(opts.local ?? {}).map(([k, v]) => [k, Buffer.from(v)]));
  const meta = new Map<string, string>();
  const failReads = { ...(opts.failReads ?? {}) };
  const corrupt = { ...(opts.corrupt ?? {}) };
  let reads = 0;
  const saved: MigrationState[] = [];
  const deps: MigrationDeps = {
    listSource: async () => {
      if (opts.listError) throw new Error(opts.listError);
      return Object.entries(source).map(([key, v]) => ({ key, size: Buffer.byteLength(v) }));
    },
    readSource: async (key) => {
      reads++;
      if (opts.capAfter != null && reads > opts.capAfter) throw new Error(CAP_MSG);
      if (failReads[key]) {
        failReads[key]--;
        throw new Error("network reset");
      }
      if (corrupt[key]) {
        corrupt[key]--;
        return { data: Buffer.from("x"), contentType: "text/plain" };
      }
      return { data: Buffer.from(source[key]), contentType: "audio/webm" };
    },
    localSize: async (key) => local.get(key)?.byteLength ?? null,
    writeLocal: async (key, data, contentType) => {
      local.set(key, data);
      meta.set(key, contentType);
    },
    diskFreeBytes: async () => (opts.diskFree === undefined ? 10 ** 12 : opts.diskFree),
    loadState: async () => saved.at(-1) ?? null,
    saveState: async (s) => {
      saved.push(structuredClone(s));
    },
  };
  return { deps, local, meta, saved, reads: () => reads };
}

const SOURCE = {
  "orgs/o/a/recordings/r1.webm": "recording-one",
  "orgs/o/a/images/s1.jpg": "shot",
  "orgs/o/a/CV/cv.pdf": "pdf-bytes",
};

test("copies every object key for key with content type, then reports done", async () => {
  const f = fakeDeps(SOURCE);
  const state = await runMigration(f.deps);
  assert.equal(state.state, "done");
  assert.equal(state.copied, 3);
  assert.equal(state.skipped, 0);
  assert.equal(state.totalObjects, 3);
  assert.equal(state.bytesCopied, Object.values(SOURCE).join("").length);
  for (const [k, v] of Object.entries(SOURCE)) assert.equal(f.local.get(k)?.toString(), v);
  assert.equal(f.meta.get("orgs/o/a/recordings/r1.webm"), "audio/webm");
  assert.equal(f.saved.at(-1)?.state, "done");
});

test("resume: files already on disk with the same size are skipped", async () => {
  const f = fakeDeps(SOURCE, { local: { "orgs/o/a/images/s1.jpg": "shot", "orgs/o/a/CV/cv.pdf": "short" } });
  const state = await runMigration(f.deps);
  assert.equal(state.skipped, 1);
  assert.equal(state.copied, 2);
  assert.equal(f.local.get("orgs/o/a/CV/cv.pdf")?.toString(), "pdf-bytes");
  assert.equal(f.reads(), 2);
});

test("transient errors and truncated downloads are retried", async () => {
  const f = fakeDeps(SOURCE, {
    failReads: { "orgs/o/a/images/s1.jpg": 2 },
    corrupt: { "orgs/o/a/CV/cv.pdf": 1 },
  });
  const state = await runMigration(f.deps);
  assert.equal(state.state, "done");
  assert.equal(state.copied, 3);
  assert.equal(f.local.get("orgs/o/a/CV/cv.pdf")?.toString(), "pdf-bytes");
});

test("a file that keeps failing is listed and the run ends as failed", async () => {
  const f = fakeDeps(SOURCE, { failReads: { "orgs/o/a/images/s1.jpg": 99 } });
  const state = await runMigration(f.deps);
  assert.equal(state.state, "failed");
  assert.equal(state.copied, 2);
  assert.equal(state.failedCount, 1);
  assert.equal(state.failed[0].key, "orgs/o/a/images/s1.jpg");
  assert.match(state.failed[0].error, /network reset/);
});

test("B2 cap exceeded pauses the run instead of failing every file", async () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`orgs/o/f${i}.bin`, `data-${i}`]));
  const f = fakeDeps(many, { capAfter: 5 });
  const state = await runMigration(f.deps);
  assert.equal(state.state, "paused");
  assert.match(state.message ?? "", /cap/);
  assert.equal(state.failedCount, 0);
  assert.ok(state.copied <= 5);
  assert.ok(f.reads() <= 5 + 4, "stops shortly after the cap error (one in-flight read per worker)");
});

test("listing refused by the cap pauses with a clear message", async () => {
  const f = fakeDeps(SOURCE, { listError: CAP_MSG });
  const state = await runMigration(f.deps);
  assert.equal(state.state, "paused");
  assert.match(state.message ?? "", /daily cap/);
});

test("not enough disk blocks the run before copying anything", async () => {
  const f = fakeDeps(SOURCE, { diskFree: 5 });
  const pre = await preflightMigration(f.deps);
  assert.equal(pre.enoughSpace, false);
  assert.equal(pre.toCopyObjects, 3);
  const state = await runMigration(f.deps);
  assert.equal(state.state, "blocked");
  assert.equal(f.reads(), 0);
});

test("verify reports missing and size-mismatched files", async () => {
  const f = fakeDeps(SOURCE, { local: { "orgs/o/a/images/s1.jpg": "shot", "orgs/o/a/CV/cv.pdf": "nope" } });
  const v = await verifyMigration(f.deps);
  assert.equal(v.totalObjects, 3);
  assert.equal(v.ok, 1);
  assert.deepEqual(v.missing, ["orgs/o/a/recordings/r1.webm"]);
  assert.equal(v.sizeMismatchCount, 1);
  assert.equal(v.sizeMismatch[0].key, "orgs/o/a/CV/cv.pdf");
});
