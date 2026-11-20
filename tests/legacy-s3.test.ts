import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { legacyS3Config, parseListObjectsV2, signS3Request } from "@/lib/legacy-s3";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-legacy-s3-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-legacy-s3-0123456789";

test("config needs endpoint, bucket and both keys; can be switched off", () => {
  const base = {
    S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com/",
    S3_BUCKET: "skillmark",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_REGION: "eu-central-003",
  } as unknown as NodeJS.ProcessEnv;
  const cfg = legacyS3Config(base);
  assert.equal(cfg?.endpoint, "https://s3.eu-central-003.backblazeb2.com");
  assert.equal(cfg?.region, "eu-central-003");
  assert.equal(legacyS3Config({ ...base, S3_SECRET_ACCESS_KEY: "" }), null);
  assert.equal(legacyS3Config({ ...base, STORAGE_LEGACY_S3: "off" }), null);
  assert.equal(legacyS3Config({ B2_ENDPOINT: "https://b2", B2_BUCKET: "b", B2_KEY_ID: "k", B2_APPLICATION_KEY: "s" } as unknown as NodeJS.ProcessEnv)?.bucket, "b");
});

test("SigV4 matches the AWS documented GET Object example", () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (GET Object, Range)
  const { headers, url } = signS3Request(
    {
      endpoint: "https://examplebucket.s3.amazonaws.com",
      bucket: "",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    "GET",
    "test.txt",
    {},
    { range: "bytes=0-9" },
    new Date("2013-05-24T00:00:00Z"),
  );
  assert.equal(url, "https://examplebucket.s3.amazonaws.com/test.txt");
  assert.match(headers.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.match(headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);
});

test("path-style URL keeps the key's folders and encodes names", () => {
  const { url } = signS3Request(
    { endpoint: "https://s3.example.com", bucket: "skillmark", region: "auto", accessKeyId: "a", secretAccessKey: "b" },
    "GET",
    "orgs/o/candidates/JIGYANSH SAHU/recordings/rec.m4a",
  );
  assert.equal(url, "https://s3.example.com/skillmark/orgs/o/candidates/JIGYANSH%20SAHU/recordings/rec.m4a");
});

test("ListObjectsV2 parsing with pagination token", () => {
  const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
    <Contents><Key>orgs/a/recordings/part-x.m4a</Key><LastModified>2026-11-18T14:10:00.000Z</LastModified><Size>51234</Size></Contents>
    <Contents><Key>orgs/a/recordings/a&amp;b.m4a</Key><Size>0</Size></Contents>
    <NextContinuationToken>tok&amp;1</NextContinuationToken></ListBucketResult>`;
  const page = parseListObjectsV2(xml);
  assert.equal(page.objects.length, 2);
  assert.equal(page.objects[0].size, 51234);
  assert.equal(page.objects[1].key, "orgs/a/recordings/a&b.m4a");
  assert.equal(page.nextToken, "tok&1");
  assert.equal(parseListObjectsV2("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>").nextToken, null);
});

test("files route and download fall back to the legacy bucket when the file is not on disk", async () => {
  process.env.S3_ENDPOINT = "https://bucket.test";
  process.env.S3_BUCKET = "skillmark";
  process.env.S3_ACCESS_KEY_ID = "id";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
  const KEY = "orgs/o/projects/p/candidates/c/recordings/recording-old.m4a";
  const BODY = Buffer.from("0123456789abcdef");
  const realFetch = globalThis.fetch;
  const calls: { url: string; range: string | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    calls.push({ url, range: h.get("range") });
    assert.ok(h.get("authorization")?.startsWith("AWS4-HMAC-SHA256"));
    if (!url.includes("recording-old.m4a")) return new Response("", { status: 404 });
    if (h.get("range") === "bytes=0-3") {
      return new Response(BODY.subarray(0, 4), {
        status: 206,
        headers: { "content-type": "application/octet-stream", "content-length": "4", "content-range": `bytes 0-3/${BODY.length}` },
      });
    }
    return new Response(BODY, { status: 200, headers: { "content-type": "audio/mp4", "content-length": String(BODY.length) } });
  }) as typeof fetch;
  try {
    const { storage } = await import("@/lib/storage");
    const { data } = await storage.from("recordings").createSignedUrl(KEY, 60);
    const url = new URL(data!.signedUrl, "http://app.test");
    const { GET } = await import("@/app/api/files/[bucket]/[...path]/route");
    const params = { bucket: "recordings", path: KEY.split("/") };

    const ranged = await GET(new Request(url, { headers: { range: "bytes=0-3" } }), { params });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-type"), "audio/mp4");
    assert.equal(ranged.headers.get("content-range"), `bytes 0-3/${BODY.length}`);
    assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), "0123");
    assert.equal(calls.at(-1)?.url, `https://bucket.test/skillmark/${KEY}`);

    const missing = "orgs/o/projects/p/candidates/c/recordings/none.m4a";
    const { data: d2 } = await storage.from("recordings").createSignedUrl(missing, 60);
    const res404 = await GET(new Request(new URL(d2!.signedUrl, "http://app.test")), {
      params: { bucket: "recordings", path: missing.split("/") },
    });
    assert.equal(res404.status, 404);

    const dl = await storage.from("recordings").download(KEY);
    assert.equal(dl.error, null);
    assert.equal(Buffer.from(await dl.data!.arrayBuffer()).toString(), BODY.toString());
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete process.env[k];
  }
});
