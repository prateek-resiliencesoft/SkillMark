import assert from "node:assert/strict";
import test from "node:test";

import {
  decideUpload,
  DISK_SAFETY_FLOOR_BYTES,
  isLiveInterviewUpload,
  isStorageCapError,
  LIVE_FINALIZE_WINDOW_MS,
  STORAGE_CAP_MESSAGES,
  storageCapLevel,
} from "@/lib/storage-cap";

const GB = 1024 ** 3;
const plentyDisk = 500 * GB;

test("storageCapLevel thresholds", () => {
  assert.equal(storageCapLevel(10 * GB, null), "ok");
  assert.equal(storageCapLevel(79 * GB, 100 * GB), "ok");
  assert.equal(storageCapLevel(80 * GB, 100 * GB), "warn80");
  assert.equal(storageCapLevel(94.9 * GB, 100 * GB), "warn80");
  assert.equal(storageCapLevel(95 * GB, 100 * GB), "warn95");
  assert.equal(storageCapLevel(100 * GB, 100 * GB), "full");
  assert.equal(storageCapLevel(120 * GB, 100 * GB), "full");
});

test("decideUpload: no cap → allowed; over cap → refused", () => {
  const base = { incomingBytes: 1_000_000, liveSession: false, diskFreeBytes: plentyDisk };
  assert.deepEqual(decideUpload({ ...base, usedBytes: 900 * GB, quotaBytes: null }), { allowed: true });
  assert.deepEqual(decideUpload({ ...base, usedBytes: 50 * GB, quotaBytes: 100 * GB }), { allowed: true });
  assert.deepEqual(decideUpload({ ...base, usedBytes: 100 * GB, quotaBytes: 100 * GB }), { allowed: false, reason: "cap" });
  // The upload itself would push it over.
  assert.deepEqual(
    decideUpload({ ...base, usedBytes: 100 * GB - 10, quotaBytes: 100 * GB }),
    { allowed: false, reason: "cap" },
  );
});

test("decideUpload: a running interview may go past the cap", () => {
  assert.deepEqual(
    decideUpload({ usedBytes: 120 * GB, quotaBytes: 100 * GB, incomingBytes: 5_000_000, liveSession: true, diskFreeBytes: plentyDisk }),
    { allowed: true },
  );
});

test("decideUpload: the disk safety floor applies to everyone", () => {
  const nearlyFull = DISK_SAFETY_FLOOR_BYTES + 1000;
  assert.deepEqual(
    decideUpload({ usedBytes: 0, quotaBytes: null, incomingBytes: 5000, liveSession: true, diskFreeBytes: nearlyFull }),
    { allowed: false, reason: "disk" },
  );
  assert.deepEqual(
    decideUpload({ usedBytes: 0, quotaBytes: null, incomingBytes: 500, liveSession: false, diskFreeBytes: nearlyFull }),
    { allowed: true },
  );
  // Unknown disk size: only the cap decides.
  assert.deepEqual(
    decideUpload({ usedBytes: 0, quotaBytes: null, incomingBytes: 500, liveSession: false, diskFreeBytes: null }),
    { allowed: true },
  );
});

test("isLiveInterviewUpload: running, or ended within the finalize window", () => {
  const now = Date.parse("2026-11-19T10:00:00Z");
  assert.equal(isLiveInterviewUpload({ status: "IN_PROGRESS" }, now), true);
  assert.equal(isLiveInterviewUpload({ status: "COMPLETED", completedAt: new Date(now - 60_000).toISOString() }, now), true);
  assert.equal(
    isLiveInterviewUpload({ status: "COMPLETED", completedAt: new Date(now - LIVE_FINALIZE_WINDOW_MS - 1).toISOString() }, now),
    false,
  );
  assert.equal(isLiveInterviewUpload({ status: "COMPLETED", completedAt: null }, now), false);
  assert.equal(isLiveInterviewUpload({ status: "ABANDONED", completedAt: new Date(now).toISOString() }, now), false);
});

test("isStorageCapError recognises only the gate's messages", () => {
  assert.equal(isStorageCapError(STORAGE_CAP_MESSAGES.cap), true);
  assert.equal(isStorageCapError(STORAGE_CAP_MESSAGES.disk), true);
  assert.equal(isStorageCapError("S3 upload failed (403)"), false);
  assert.equal(isStorageCapError(null), false);
});
