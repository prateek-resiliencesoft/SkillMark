/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { w3Db } from "./sec-w3-db";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-reject-media-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-reject-media-0123456789";

const ORG = "11111111-1111-1111-1111-111111111111";
const PROJ = "proj-1";
const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const interview = { id: "int-1", projectId: PROJ, project: { id: PROJ, organizationId: ORG } };

async function put(key: string, body = "data") {
  const { storage } = await import("@/lib/storage");
  const r = await storage.from("recordings").upload(key, Buffer.from(body), { upsert: true });
  assert.equal(r.error, null, key);
}
const onDisk = (key: string) => existsSync(path.join(dir, key));

describe("applyMediaReview decline options", () => {
  it("declined without deleteMedia keeps files and saves reason/tags", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Keep_media`;
    const key = `${folder}/recordings/keep.webm`;
    await put(key);
    const session = {
      id: SID,
      mediaStoragePrefix: folder,
      participantEmail: "keep@example.com",
      audioRecordingUrl: key,
      interview,
    };
    const db = w3Db({ sessions: [session], candidates: [] });
    const { applyMediaReview } = await import("@/lib/media-review");
    const result = await applyMediaReview(db as any, SID, "declined", {
      rejectReason: "  Low integrity  ",
      rejectTags: ["cheating", "custom"],
    });

    assert.equal(result.cleared, 0);
    assert.equal(onDisk(key), true);
    const row = db.tables.sessions.find((s) => s.id === SID);
    assert.equal(row?.mediaReviewStatus, "declined");
    assert.equal(row?.rejectReason, "Low integrity");
    assert.deepEqual(row?.rejectTags, ["cheating", "custom"]);
    assert.equal(row?.mediaClearedAt ?? null, null);
  });

  it("declined with deleteMedia true clears files", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Wipe_media`;
    const key = `${folder}/recordings/wipe.webm`;
    await put(key);
    const session = {
      id: SID,
      mediaStoragePrefix: folder,
      participantEmail: "wipe@example.com",
      audioRecordingUrl: key,
      interview,
    };
    const db = w3Db({ sessions: [session], candidates: [] });
    const { applyMediaReview } = await import("@/lib/media-review");
    const result = await applyMediaReview(db as any, SID, "declined", {
      deleteMedia: true,
      rejectReason: "Cheating",
      rejectTags: ["cheating"],
    });

    assert.ok(result.cleared >= 1);
    assert.equal(onDisk(key), false);
    const row = db.tables.sessions.find((s) => s.id === SID);
    assert.equal(row?.mediaReviewStatus, "declined");
    assert.equal(row?.rejectReason, "Cheating");
    assert.ok(row?.mediaClearedAt);
  });

  it("approved clears reject fields", async () => {
    const session = {
      id: SID,
      mediaStoragePrefix: null,
      participantEmail: "a@example.com",
      rejectReason: "old",
      rejectTags: ["cheating"],
      interview,
    };
    const db = w3Db({ sessions: [session], candidates: [] });
    const { applyMediaReview } = await import("@/lib/media-review");
    await applyMediaReview(db as any, SID, "approved");
    const row = db.tables.sessions.find((s) => s.id === SID);
    assert.equal(row?.mediaReviewStatus, "approved");
    assert.equal(row?.rejectReason, null);
    assert.deepEqual(row?.rejectTags, []);
  });
});
