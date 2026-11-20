import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-w3-storage-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-w3-storage-0123456789";

import {
  isSafeObjectPath,
  objectPathFromSignedUrl,
  pathBelongsToOrganization,
  pathBelongsToSession,
} from "@/lib/tenant-storage";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJ_A1 = "proj-a1";
const PROJ_A2 = "proj-a2";
const OWN_PREFIX = `orgs/${ORG_A}/projects/${PROJ_A1}/candidates/Jane_Doe_deadbeef`;
const scope = { projectId: PROJ_A1, mediaStoragePrefix: OWN_PREFIX };

describe("SKILLMARK-ISOLATION-TENANT-STORAGE-DOTDOT-TRAVERSAL", () => {
  const traversal = `orgs/${ORG_A}/projects/${PROJ_A1}/candidates/session-${SID}/recordings/../../../../../../orgs/${ORG_B}/projects/p/candidates/x/recordings/secret.webm`;

  it("pathBelongsToSession rejects '..' escapes from the session's own folder", () => {
    assert.equal(pathBelongsToSession(traversal, SID, ORG_A), false);
    assert.equal(pathBelongsToSession(traversal, SID, ORG_A, scope), false);
  });

  it("pathBelongsToOrganization rejects '..', '.', backslash, NUL and encoded dot segments", () => {
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/../orgs/${ORG_B}/x.pdf`, ORG_A), false);
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/./x.pdf`, ORG_A), false);
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/a\\..\\b.pdf`, ORG_A), false);
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/a\0.pdf`, ORG_A), false);
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/%2e%2e/orgs/${ORG_B}/x.pdf`, ORG_A), false);
    assert.equal(pathBelongsToOrganization(`orgs/${ORG_A}/projects/p/candidates/c/CV/0.pdf`, ORG_A), true);
  });

  it("objectPathFromSignedUrl never emits dot segments", () => {
    assert.equal(objectPathFromSignedUrl("recordings", `orgs/${ORG_A}/../orgs/${ORG_B}/a.webm`), null);
    const url = `https://app.test/api/files/recordings/orgs/${ORG_A}/%252e%252e/orgs/${ORG_B}/a.webm?token=x`;
    assert.equal(objectPathFromSignedUrl("recordings", url), null);
    assert.equal(isSafeObjectPath(`orgs/${ORG_A}/x/a.webm`), true);
  });

  it("localPathForKey refuses dot segments, backslashes and NUL", async () => {
    const { localPathForKey } = await import("@/lib/storage");
    for (const bad of [
      `orgs/${ORG_A}/../${ORG_B}/a.webm`,
      `orgs/${ORG_A}/./a.webm`,
      `orgs/${ORG_A}\\..\\a.webm`,
      `orgs/${ORG_A}/a\0.webm`,
      "..",
      "",
    ]) {
      assert.throws(() => localPathForKey(bad), /Invalid storage path/, bad);
    }
    assert.ok(localPathForKey(`orgs/${ORG_A}/x/a.webm`).startsWith(dir));
  });

  it("signed-URL minting refuses traversal keys", async () => {
    const { storage } = await import("@/lib/storage");
    const r = await storage.from("recordings").createSignedUrl(`orgs/${ORG_A}/../${ORG_B}/a.webm`, 60);
    assert.equal(r.data, null);
    assert.ok(r.error);
  });
});

describe("SKILLMARK-ISOLATION-SESSION-PATH-ORG-WILDCARD", () => {
  it("rejects another project's or another candidate's folder in the same org", () => {
    const otherProject = `orgs/${ORG_A}/projects/${PROJ_A2}/candidates/Victim_12345678/recordings/a.webm`;
    const otherCandidate = `orgs/${ORG_A}/projects/${PROJ_A1}/candidates/Victim_12345678/recordings/a.webm`;
    assert.equal(pathBelongsToSession(otherProject, SID, ORG_A), false);
    assert.equal(pathBelongsToSession(otherProject, SID, ORG_A, scope), false);
    assert.equal(pathBelongsToSession(otherCandidate, SID, ORG_A), false);
    assert.equal(pathBelongsToSession(otherCandidate, SID, ORG_A, scope), false);
  });

  it("rejects a session-<id> folder in a different project when the scope is known", () => {
    const p = `orgs/${ORG_A}/projects/${PROJ_A2}/candidates/session-${SID}/recordings/a.webm`;
    assert.equal(pathBelongsToSession(p, SID, ORG_A, scope), false);
  });

  it("rejects CV / non-media kinds even in the session's own folder", () => {
    assert.equal(pathBelongsToSession(`${OWN_PREFIX}/CV/resume.pdf`, SID, ORG_A, scope), false);
    assert.equal(pathBelongsToSession(`${OWN_PREFIX}/other/x.pdf`, SID, ORG_A, scope), false);
  });

  it("accepts the session's own media folder and its session-<id> folder", () => {
    assert.equal(pathBelongsToSession(`${OWN_PREFIX}/recordings/a.webm`, SID, ORG_A, scope), true);
    assert.equal(pathBelongsToSession(`${OWN_PREFIX}/images/cam.jpg`, SID, ORG_A, scope), true);
    assert.equal(
      pathBelongsToSession(`orgs/${ORG_A}/projects/${PROJ_A1}/candidates/session-${SID}/recordings/a.webm`, SID, ORG_A, scope),
      true,
    );
  });
});

describe("SKILLMARK-STORAGE-SIDECAR-FILENAME-QUOTA-BYPASS", () => {
  it("refuses object names that collide with sidecar / temp names", async () => {
    const { localPathForKey, storage } = await import("@/lib/storage");
    assert.throws(() => localPathForKey(`orgs/${ORG_A}/p/rec.webm.meta`));
    assert.throws(() => localPathForKey(`orgs/${ORG_A}/p/rec.webm.part-1-1`));
    const r = await storage.from("recordings").upload(`orgs/${ORG_A}/p/hidden.meta`, Buffer.from("x".repeat(1000)));
    assert.ok(r.error);
    assert.equal(existsSync(path.join(dir, `orgs/${ORG_A}/p/hidden.meta`)), false);
  });

  it("prefix deletion sweeps orphan sidecars and stale temp files", async () => {
    const { deletePrefix, storage } = await import("@/lib/storage");
    const prefix = `orgs/${ORG_A}/projects/sweep/candidates/c`;
    await storage.from("recordings").upload(`${prefix}/recordings/a.webm`, Buffer.from("abc"), { contentType: "audio/webm" });
    const folder = path.join(dir, prefix, "recordings");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "legacy-hidden.meta"), "y".repeat(500));
    const stale = path.join(folder, "old.part-1-1");
    writeFileSync(stale, "z");
    const { utimesSync } = await import("node:fs");
    utimesSync(stale, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
    await deletePrefix(prefix);
    assert.equal(existsSync(path.join(folder, "a.webm")), false);
    assert.equal(existsSync(path.join(folder, "a.webm.meta")), false);
    assert.equal(existsSync(path.join(folder, "legacy-hidden.meta")), false);
    assert.equal(existsSync(stale), false);
  });
});

describe("SKILLMARK-STORAGE-UNBOUNDED-SUPPORT-QUOTA-EXHAUSTION: upload quota reservation", () => {
  it("concurrent uploads see each other's in-flight bytes at the cap gate", async () => {
    const { setUploadGate, storage } = await import("@/lib/storage");
    const QUOTA = 100;
    setUploadGate(async (bytes) => {
      await new Promise((r) => setTimeout(r, 5));
      return bytes > QUOTA ? "Storage limit reached" : null;
    });
    try {
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          storage.from("support-attachments").upload(`quota/${i}.bin`, Buffer.alloc(60), { contentType: "application/octet-stream" }),
        ),
      );
      const ok = results.filter((r) => !r.error).length;
      assert.equal(ok, 1, "only one 60-byte upload fits under a 100-byte cap");
      // Reservations are released afterwards.
      const later = await storage.from("support-attachments").upload("quota/later.bin", Buffer.alloc(60));
      assert.equal(later.error, null);
    } finally {
      setUploadGate(null);
    }
  });
});
