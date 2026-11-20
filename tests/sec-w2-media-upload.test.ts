/**
 * W2 recheck: candidate media + preflight.
 *  - /api/session/upload: Content-Length gate before buffering, capability, live window,
 *    mediaClearedAt, reserved sidecar names, content sniffing, immutable parts
 *  - /api/session/recording/finalize: capability + live window
 *  - storage caps: bounded live overage, per-session upload budget, screenshot cap
 *  - preflight: an invite token cannot write to a foreign / closed session
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capCookie, installDb, iso, uuid } from "./sec-w2-db";
import { POST as upload } from "@/app/api/session/upload/route";
import { POST as finalize } from "@/app/api/session/recording/finalize/route";
import { authorizePreflightSource } from "@/lib/preflight-server";
import { isReservedObjectName, matchesMediaSignature, mediaObjectKey, mediaUploadFileName } from "@/lib/storage-paths";
import { decideUpload, reserveSessionUpload, SESSION_UPLOAD_MAX_OBJECTS } from "@/lib/storage-cap";
import { linkScreenshotToSession, MAX_SESSION_SCREENSHOTS } from "@/lib/recording-parts-server";
import { jsonPost } from "./sec-w2-db";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

function mediaSession(over: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    interviewId: "iv-1",
    candidateId: null,
    status: "IN_PROGRESS",
    supersededAt: null,
    capabilityRequired: true,
    interviewBeganAt: iso(60_000),
    lastHeartbeatAt: iso(2_000),
    lastActivityAt: iso(2_000),
    completedAt: null,
    endReason: null,
    mediaStoragePrefix: "orgs/o1/projects/p1/candidates/c1",
    mediaClearedAt: null,
    participantName: "Cand",
    participantEmail: null,
    screenshots: [],
    interview: { id: "iv-1", projectId: "p1", project: { id: "p1", organizationId: "o1" } },
    ...over,
  };
}

let ip = 0;
function uploadReq(
  sessionId: string,
  fields: Record<string, string>,
  file: Uint8Array,
  opts: { cookie?: boolean; fileName?: string; mime?: string; headers?: Record<string, string> } = {},
) {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(file)], { type: opts.mime ?? "image/jpeg" }), opts.fileName ?? "f.jpg");
  fd.append("sessionId", sessionId);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const probe = new Request("http://localhost/api/session/upload", { method: "POST", body: fd });
  return probe.arrayBuffer().then(
    (buf) =>
      new Request("http://localhost/api/session/upload", {
        method: "POST",
        body: buf,
        headers: {
          "content-type": probe.headers.get("content-type")!,
          "content-length": String(buf.byteLength),
          "x-real-ip": `10.9.${Math.floor(++ip / 250)}.${ip % 250}`,
          ...(opts.cookie === false ? {} : { cookie: capCookie(sessionId) }),
          ...opts.headers,
        },
      }),
  );
}

describe("POST /api/session/upload", () => {
  it("rejects a missing or oversized Content-Length before reading the body", async () => {
    const s = mediaSession();
    installDb({ sessions: [s] });
    let read = false;
    // highWaterMark 0: the stream only pulls when someone actually reads the body.
    const body = new ReadableStream(
      {
        pull() {
          read = true;
          throw new Error("body must not be read");
        },
      },
      { highWaterMark: 0 },
    );
    const big = new Request("http://localhost/api/session/upload", {
      method: "POST",
      body,
      // @ts-expect-error node fetch needs duplex for stream bodies
      duplex: "half",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(500 * 1024 * 1024) },
    });
    assert.equal((await upload(big)).status, 413);
    const none = new Request("http://localhost/api/session/upload", {
      method: "POST",
      body: new ReadableStream({ pull: () => void (read = true) }, { highWaterMark: 0 }),
      // @ts-expect-error node fetch needs duplex for stream bodies
      duplex: "half",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    assert.equal((await upload(none)).status, 411);
    assert.equal(read, false);
  });

  it("refuses uploads without the session capability", async () => {
    const s = mediaSession();
    const db = installDb({ sessions: [s] });
    const res = await upload(await uploadReq(s.id, { type: "screenshot", filename: "x-camera.jpg" }, JPEG, { cookie: false }));
    assert.equal(res.status, 403);
    assert.equal(db.storage.uploads.length, 0);
  });

  const closed: [string, Record<string, unknown>][] = [
    ["media-cleared session", { mediaClearedAt: iso(1_000) }],
    ["ABANDONED session", { status: "ABANDONED" }],
    ["COMPLETED 2 h ago", { status: "COMPLETED", completedAt: iso(2 * 3_600_000) }],
    ["superseded session", { supersededAt: iso(1_000) }],
  ];
  for (const [label, over] of closed) {
    it(`refuses writes to a ${label}`, async () => {
      const s = mediaSession(over);
      const db = installDb({ sessions: [s] });
      const res = await upload(await uploadReq(s.id, { type: "screenshot", filename: "x-camera.jpg" }, JPEG));
      assert.equal(res.status, 403);
      assert.equal(db.storage.uploads.length, 0);
    });
  }

  it("never stores reserved sidecar names (.meta / .part-N-N)", async () => {
    const s = mediaSession();
    const db = installDb({ sessions: [s] });
    for (const filename of ["evil.meta", "evil.part-1-1", "payload.html"]) {
      const res = await upload(await uploadReq(s.id, { type: "screenshot", filename }, JPEG));
      assert.equal(res.status, 200, filename);
    }
    assert.equal(db.storage.uploads.length, 3);
    for (const u of db.storage.uploads) {
      const name = u.key.split("/").pop()!;
      assert.equal(isReservedObjectName(name), false, name);
      assert.match(name, /\.jpg$/);
      assert.equal(u.contentType, "image/jpeg");
    }
  });

  it("refuses content that is not the declared media type", async () => {
    const s = mediaSession();
    const db = installDb({ sessions: [s] });
    const res = await upload(await uploadReq(s.id, { type: "screenshot", filename: "x.jpg" }, HTML, { mime: "image/jpeg" }));
    assert.equal(res.status, 415);
    assert.equal(db.storage.uploads.length, 0);
  });

  it("recording parts are immutable: a second upload of the same part does not overwrite", async () => {
    const s = mediaSession();
    const db = installDb({ sessions: [s] });
    const fields = { type: "recording_part", runId: "1732000000000", seq: "0", elapsedSec: "10" };
    const first = await upload(await uploadReq(s.id, fields, new Uint8Array([1, 2, 3]), { mime: "audio/webm" }));
    assert.equal(first.status, 200);
    const second = await upload(await uploadReq(s.id, fields, new Uint8Array([9, 9, 9, 9]), { mime: "audio/webm" }));
    assert.equal(second.status, 200);
    assert.equal((await second.json()).duplicate, true);
    assert.equal(db.storage.uploads.length, 1);
    assert.equal(db.storage.uploads[0].bytes, 3);
    assert.equal(db.storage.uploads[0].upsert, false);
  });
});

describe("POST /api/session/recording/finalize", () => {
  it("refuses callers without the capability and ended sessions", async () => {
    const s = mediaSession();
    const ab = mediaSession({ status: "ABANDONED" });
    const cleared = mediaSession({ status: "COMPLETED", completedAt: iso(1_000), mediaClearedAt: iso(500) });
    installDb({ sessions: [s, ab, cleared] });
    assert.equal((await finalize(jsonPost("/api/session/recording/finalize", { sessionId: s.id, background: true }))).status, 403);
    for (const x of [ab, cleared]) {
      const res = await finalize(jsonPost("/api/session/recording/finalize", { sessionId: x.id, background: true }, { cookie: capCookie(x.id) }));
      assert.equal(res.status, 403);
    }
  });
});

describe("storage helpers", () => {
  it("mediaObjectKey neutralises reserved names for every caller", () => {
    const key = mediaObjectKey({ orgId: "o", projectId: "p", candidateId: "c", kind: "CV", fileName: "cv.meta" });
    assert.equal(isReservedObjectName(key.split("/").pop()!), false);
    const key2 = mediaObjectKey({ orgId: "o", projectId: "p", candidateId: "c", kind: "images", fileName: "a.part-12-34" });
    assert.equal(isReservedObjectName(key2.split("/").pop()!), false);
  });

  it("upload names are allowlisted per type", () => {
    assert.equal(mediaUploadFileName("2026-11-20T10-00-00-000Z-camera.jpg", "screenshot", "fb.jpg"), "2026-11-20T10-00-00-000Z-camera.jpg");
    assert.equal(mediaUploadFileName("recording-1.webm", "recording", "fb.webm"), "recording-1.webm");
    assert.equal(mediaUploadFileName("x.svg", "screenshot", "fb.jpg"), "fb.jpg");
    assert.equal(mediaUploadFileName("x.jpg", "recording", "fb.webm"), "fb.webm");
    assert.equal(mediaUploadFileName(".jpg", "screenshot", "fb.jpg"), "fb.jpg");
  });

  it("content sniffing accepts real containers only", () => {
    assert.equal(matchesMediaSignature(JPEG, "a.jpg"), true);
    assert.equal(matchesMediaSignature(HTML, "a.jpg"), false);
    assert.equal(matchesMediaSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0]), "r.webm"), true);
    assert.equal(matchesMediaSignature(new TextEncoder().encode("OggS\0\0"), "r.m4a"), true);
    assert.equal(matchesMediaSignature(HTML, "r.webm"), false);
  });

  it("live interviews may exceed the cap only by a bounded overage", () => {
    const GB = 1024 ** 3;
    const base = { quotaBytes: 100 * GB, incomingBytes: 1_000, liveSession: true, diskFreeBytes: 10_000 * GB };
    assert.deepEqual(decideUpload({ ...base, usedBytes: 110 * GB }), { allowed: true });
    assert.deepEqual(decideUpload({ ...base, usedBytes: 126 * GB }), { allowed: false, reason: "cap" });
  });

  it("per-session upload budget stops unbounded object counts", () => {
    const sid = uuid();
    for (let i = 0; i < SESSION_UPLOAD_MAX_OBJECTS; i++) assert.equal(reserveSessionUpload(sid, 1), null);
    assert.notEqual(reserveSessionUpload(sid, 1), null);
    assert.notEqual(reserveSessionUpload(uuid(), 2 * 1024 ** 3), null);
  });

  it("sessions.screenshots stops growing at the cap", async () => {
    const full = Array.from({ length: MAX_SESSION_SCREENSHOTS }, (_, i) => ({ path: `p${i}` }));
    const s = mediaSession({ screenshots: full });
    installDb({ sessions: [s] });
    const ok = await linkScreenshotToSession(s.id, { url: "u", path: "new", timestamp: iso(0), type: "camera" });
    assert.equal(ok, false);
    assert.equal((s.screenshots as unknown[]).length, MAX_SESSION_SCREENSHOTS);
  });
});

describe("preflight session binding", () => {
  it("a token whose candidate has no session cannot target a foreign session", async () => {
    const victim = mediaSession({ candidateId: "victim-cand" });
    installDb({ sessions: [victim], candidates: [{ id: "att", sessionId: null, inviteToken: "att-tok", expiresAt: null }] });
    const r = await authorizePreflightSource({ token: "att-tok", sessionId: victim.id, cookieHeader: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  });

  it("a token's own session is only touched with its capability and while open", async () => {
    const own = mediaSession({ candidateId: "own" });
    installDb({ sessions: [own], candidates: [{ id: "own", sessionId: own.id, inviteToken: "own-tok", expiresAt: null }] });
    const noCap = await authorizePreflightSource({ token: "own-tok", sessionId: own.id, cookieHeader: null });
    assert.ok(noCap.ok);
    if (noCap.ok) assert.equal(noCap.sessionId, null);
    const withCap = await authorizePreflightSource({ token: "own-tok", sessionId: own.id, cookieHeader: capCookie(own.id) });
    assert.ok(withCap.ok);
    if (withCap.ok) assert.equal(withCap.sessionId, own.id);

    own.status = "COMPLETED";
    const closed = await authorizePreflightSource({ token: "own-tok", sessionId: own.id, cookieHeader: capCookie(own.id) });
    assert.ok(closed.ok);
    if (closed.ok) assert.equal(closed.sessionId, null);
  });

  it("session-only events need the capability and an open, non-superseded session", async () => {
    const s = mediaSession();
    const sup = mediaSession({ supersededAt: iso(1_000), interviewBeganAt: null });
    installDb({ sessions: [s, sup] });
    const bare = await authorizePreflightSource({ sessionId: s.id, cookieHeader: null });
    assert.equal(bare.ok, false);
    const revoked = await authorizePreflightSource({ sessionId: sup.id, cookieHeader: capCookie(sup.id) });
    assert.equal(revoked.ok, false);
    const ok = await authorizePreflightSource({ sessionId: s.id, cookieHeader: capCookie(s.id) });
    assert.equal(ok.ok, true);
  });

  it("an expired invite with no session cannot post events", async () => {
    installDb({ candidates: [{ id: "exp", sessionId: null, inviteToken: "exp-tok", expiresAt: iso(1_000) }] });
    const r = await authorizePreflightSource({ token: "exp-tok", cookieHeader: null });
    assert.equal(r.ok, false);
  });
});
