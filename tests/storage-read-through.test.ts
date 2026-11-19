import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-readthrough-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-read-through-0123456789";
process.env.S3_ENDPOINT = "https://s3.eu-central-003.backblazeb2.com";
process.env.S3_REGION = "eu-central-003";
process.env.S3_BUCKET = "old-bucket";
process.env.S3_ACCESS_KEY_ID = "key";
process.env.S3_SECRET_ACCESS_KEY = "secret";

const CAP_XML =
  '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Cannot download file, download bandwidth or transaction (Class B) cap exceeded. See the Caps &amp; Alerts page to increase your cap.</Message></Error>';

type Reply = { status: number; body: string; type?: string };
let bucket: Record<string, Reply> = {};
let calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(process.env.S3_ENDPOINT!)) return realFetch(input, init);
  calls.push(url);
  await new Promise((r) => setTimeout(r, 20));
  const key = decodeURIComponent(new URL(url).pathname.replace(/^\/old-bucket\//, ""));
  const reply = bucket[key] ?? { status: 404, body: "<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>" };
  return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.type ?? "application/xml" } });
}) as typeof fetch;

async function load() {
  const storage = await import("@/lib/storage");
  const route = await import("@/app/api/files/[bucket]/[...path]/route");
  return { storage, GET: route.GET };
}

async function request(key: string, init?: RequestInit) {
  const { storage, GET } = await load();
  const { data } = await storage.storage.from("recordings").createSignedUrl(key, 60);
  const url = new URL(data!.signedUrl, "http://app.test");
  return { url, res: await GET(new Request(url, init), { params: { bucket: "recordings", path: key.split("/") } }) };
}

test("signed URLs point at the server even before the file is copied", async () => {
  const { url } = await request("orgs/o/p/candidates/a/recordings/not-yet.webm");
  assert.match(url.pathname, /^\/api\/files\/recordings\/orgs\//);
});

test("first view copies the file from the old bucket; later views never touch it", async () => {
  const key = "orgs/o/p/candidates/a/recordings/old.webm";
  bucket = { [key]: { status: 200, body: "old-recording-bytes", type: "audio/webm" } };
  calls = [];
  const [a, b] = await Promise.all([request(key), request(key)]);
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  assert.equal(await a.res.text(), "old-recording-bytes");
  assert.equal(a.res.headers.get("content-type"), "audio/webm");
  assert.equal(calls.length, 1, "concurrent views share one bucket download");
  assert.equal(readFileSync(path.join(dir, key), "utf8"), "old-recording-bytes");
  assert.equal(readFileSync(path.join(dir, key + ".meta"), "utf8"), "audio/webm");

  const ranged = await request(key, { headers: { Range: "bytes=4-12" } });
  assert.equal(ranged.res.status, 206);
  assert.equal(await ranged.res.text(), "recording");
  assert.equal(calls.length, 1);
});

test("bucket cap reached: readable 503 instead of the bucket's XML error", async () => {
  const key = "orgs/o/p/candidates/a/images/capped.jpg";
  bucket = { [key]: { status: 403, body: CAP_XML } };
  const { res } = await request(key);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /daily download limit/);
  assert.equal(existsSync(path.join(dir, key)), false);
});

test("file in neither place: 404", async () => {
  bucket = {};
  const { res } = await request("orgs/o/p/candidates/a/cv/missing.pdf");
  assert.equal(res.status, 404);
});

test("server-side reads (download) also keep the copied file", async () => {
  const key = "orgs/o/p/candidates/b/recordings/server-read.webm";
  bucket = { [key]: { status: 200, body: "for-transcription", type: "audio/webm" } };
  const { storage } = await load();
  const { data, error } = await storage.storage.from("recordings").download(key);
  assert.equal(error, null);
  assert.equal(await data!.text(), "for-transcription");
  assert.equal(readFileSync(path.join(dir, key), "utf8"), "for-transcription");
});

test("cap error message decodes &amp;", async () => {
  const { storage } = await load();
  const key = "orgs/o/p/candidates/c/recordings/x.webm";
  bucket = { [key]: { status: 403, body: CAP_XML } };
  await assert.rejects(storage.readLegacyS3Object(key), (err: Error) => {
    assert.match(err.message, /Caps & Alerts page/);
    assert.doesNotMatch(err.message, /&amp;|\.\./);
    return true;
  });
});
