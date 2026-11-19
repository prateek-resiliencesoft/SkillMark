import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveStorageDriver } from "@/lib/storage-driver";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-storage-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_CAP_GATE = "off";
for (const k of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_ENDPOINT", "B2_KEY_ID", "R2_ACCOUNT_ID"]) {
  delete process.env[k];
}

test("resolveStorageDriver: default keeps S3 when credentials exist", () => {
  assert.deepEqual(resolveStorageDriver({ driver: undefined, hasS3Credentials: true }), { writes: "s3", legacyS3Reads: false });
  assert.deepEqual(resolveStorageDriver({ driver: "s3", hasS3Credentials: true }), { writes: "s3", legacyS3Reads: false });
  assert.deepEqual(resolveStorageDriver({ driver: "", hasS3Credentials: false }), { writes: "local", legacyS3Reads: false });
});

test("resolveStorageDriver: local + creds = local writes with bucket read fallback", () => {
  assert.deepEqual(resolveStorageDriver({ driver: "local", hasS3Credentials: true }), { writes: "local", legacyS3Reads: true });
  assert.deepEqual(resolveStorageDriver({ driver: " LOCAL ", hasS3Credentials: false }), { writes: "local", legacyS3Reads: false });
});

test("local storage: upload, signed URL bound to object key, read, remove", async () => {
  const { storage, statLocalObject, verifyFileToken, getStorageConfigSummary, isLegacyS3ReadEnabled } = await import(
    "@/lib/storage"
  );
  assert.equal(isLegacyS3ReadEnabled(), false);
  assert.equal(getStorageConfigSummary().provider, "VPS Disk");

  const key = "orgs/o1/projects/p1/candidates/c1/images/2026-shot-camera.jpg";
  const up = await storage.from("images").upload(key, Buffer.from("jpegdata"), { contentType: "image/jpeg" });
  assert.equal(up.error, null);
  assert.equal(up.data?.path, key);
  assert.equal(readFileSync(path.join(dir, key), "utf8"), "jpegdata");
  assert.equal(readFileSync(path.join(dir, key + ".meta"), "utf8"), "image/jpeg");

  const dup = await storage.from("images").upload(key, Buffer.from("x"));
  assert.match(dup.error?.message ?? "", /already exists/);

  const st = await statLocalObject(key);
  assert.equal(st?.size, 8);
  assert.equal(st?.contentType, "image/jpeg");

  const signed = await storage.from("images").createSignedUrl(key, 60);
  const url = new URL(signed.data!.signedUrl, "http://x.invalid");
  assert.equal(decodeURIComponent(url.pathname), `/api/files/images/${key}`);
  assert.ok(await verifyFileToken(url.searchParams.get("token")!, "images", key));

  const dl = await storage.from("images").download(key);
  assert.equal(await dl.data!.text(), "jpegdata");

  await storage.from("images").remove([key]);
  assert.equal(existsSync(path.join(dir, key)), false);
  assert.equal(existsSync(path.join(dir, key + ".meta")), false);
});

test("local storage: legacy (non orgs/) paths are stored under bucket/ and signed for that key", async () => {
  const { storage, verifyFileToken } = await import("@/lib/storage");
  const up = await storage.from("recordings").upload("abc/rec.webm", Buffer.from("aa"), { contentType: "audio/webm" });
  assert.equal(up.data?.path, "recordings/abc/rec.webm");
  const signed = await storage.from("recordings").createSignedUrl("abc/rec.webm", 60);
  const url = new URL(signed.data!.signedUrl, "http://x.invalid");
  assert.equal(decodeURIComponent(url.pathname), "/api/files/recordings/recordings/abc/rec.webm");
  assert.ok(await verifyFileToken(url.searchParams.get("token")!, "recordings", "recordings/abc/rec.webm"));
});

test("local storage: path traversal is refused", async () => {
  const { storage, localPathForKey } = await import("@/lib/storage");
  assert.throws(() => localPathForKey("../etc/passwd"), /Invalid storage path/);
  const up = await storage.from("images").upload("orgs/../../../etc/x", Buffer.from("x"));
  assert.ok(up.error);
});

test("upload gate: refusal is returned as the upload error and nothing is written", async () => {
  const { storage, setUploadGate, statLocalObject } = await import("@/lib/storage");
  const seen: { bytes: number; liveSession: boolean }[] = [];
  setUploadGate(async (bytes, opts) => {
    seen.push({ bytes, ...opts });
    return opts.liveSession ? null : "Storage limit reached. Ask the platform admin to raise the storage cap.";
  });
  try {
    const refused = await storage.from("files").upload("orgs/o3/cv.pdf", Buffer.from("pdf!"));
    assert.match(refused.error?.message ?? "", /Storage limit reached/);
    assert.equal(await statLocalObject("orgs/o3/cv.pdf"), null);

    const live = await storage.from("recordings").upload("orgs/o3/rec.webm", Buffer.from("rec"), { liveSession: true });
    assert.equal(live.error, null);
    assert.deepEqual(seen, [
      { bytes: 4, liveSession: false },
      { bytes: 3, liveSession: true },
    ]);
  } finally {
    setUploadGate(null);
  }
});

test("listing skips .meta sidecars and temp files", async () => {
  const { storage, listAllObjects } = await import("@/lib/storage");
  await storage.from("files").upload("orgs/o2/a.txt", Buffer.from("1"), { contentType: "text/plain" });
  await storage.from("files").upload("orgs/o2/b.txt", Buffer.from("22"));
  const items = await listAllObjects("orgs/o2");
  assert.deepEqual(items.map((i) => i.key).sort(), ["orgs/o2/a.txt", "orgs/o2/b.txt"]);
  assert.equal(items.reduce((n, i) => n + i.size, 0), 3);
});
