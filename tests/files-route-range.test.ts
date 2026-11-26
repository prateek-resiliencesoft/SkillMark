import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseRangeHeader } from "@/lib/http-range";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-files-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-files-route-0123456789";

test("parseRangeHeader", () => {
  assert.equal(parseRangeHeader(null, 100), null);
  assert.deepEqual(parseRangeHeader("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRangeHeader("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRangeHeader("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRangeHeader("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseRangeHeader("bytes=100-", 100), "invalid");
  assert.equal(parseRangeHeader("bytes=9-3", 100), "invalid");
  assert.equal(parseRangeHeader("items=0-1", 100), "invalid");
  assert.equal(parseRangeHeader("bytes=0-1,5-6", 100), null);
});

const KEY = "orgs/o/projects/p/candidates/c/recordings/rec.webm";
const BODY = Buffer.from(Array.from({ length: 200 }, (_, i) => i % 256));

async function setup() {
  const { storage } = await import("@/lib/storage");
  await storage.from("recordings").upload(KEY, BODY, { contentType: "audio/webm", upsert: true });
  const { data } = await storage.from("recordings").createSignedUrl(KEY, 60);
  const url = new URL(data!.signedUrl, "http://app.test");
  const { GET } = await import("@/app/api/files/[bucket]/[...path]/route");
  const params = { bucket: "recordings", path: KEY.split("/") };
  return { url, GET, params };
}

test("files route: full file 200 with length and type", async () => {
  const { url, GET, params } = await setup();
  const res = await GET(new Request(url), { params });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/webm");
  assert.equal(res.headers.get("content-length"), "200");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY);
});

test("files route: Range returns 206 with the requested bytes", async () => {
  const { url, GET, params } = await setup();
  const res = await GET(new Request(url, { headers: { range: "bytes=0-99" } }), { params });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-99/200");
  assert.equal(res.headers.get("content-length"), "100");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY.subarray(0, 100));
});

test("files route: unsatisfiable range is 416", async () => {
  const { url, GET, params } = await setup();
  const res = await GET(new Request(url, { headers: { range: "bytes=500-" } }), { params });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), "bytes */200");
});

test("files route: bad token is 403, missing file is 404", async () => {
  const { url, GET, params } = await setup();
  const bad = new URL(url);
  bad.searchParams.set("token", "nope");
  assert.equal((await GET(new Request(bad), { params })).status, 403);

  const { signFileToken } = await import("@/lib/storage");
  const missing = "orgs/o/missing.webm";
  const tok = await signFileToken("recordings", missing, 60);
  const res = await GET(new Request(`http://app.test/api/files/recordings/${missing}?token=${tok}`), {
    params: { bucket: "recordings", path: missing.split("/") },
  });
  assert.equal(res.status, 404);
});
