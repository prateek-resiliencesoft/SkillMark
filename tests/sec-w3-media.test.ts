/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { w3Db } from "./sec-w3-db";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-w3-media-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-w3-media-0123456789";

const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const PROJ = "proj-1";
const SID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const interview = { id: "int-1", projectId: PROJ, project: { id: PROJ, organizationId: ORG } };

async function put(key: string, body = "data") {
  const { storage } = await import("@/lib/storage");
  const r = await storage.from("recordings").upload(key, Buffer.from(body), { upsert: true });
  assert.equal(r.error, null, key);
}
const onDisk = (key: string) => existsSync(path.join(dir, key));

function sharedFixture(folder: string) {
  const a = {
    id: SID_A,
    mediaStoragePrefix: folder,
    participantEmail: "victim@example.com",
    audioRecordingUrl: `${folder}/recordings/a.webm`,
    screenshots: [{ path: `${folder}/images/a.jpg`, url: "https://evil.example/x.jpg" }],
    antiCheatingLog: [{ type: "tab_switch", imagePath: `orgs/${ORG_B}/projects/p/candidates/x/images/foreign.jpg` }],
    interview,
  };
  const b = {
    id: SID_B,
    mediaStoragePrefix: folder,
    participantEmail: "victim@example.com",
    audioRecordingUrl: `${folder}/recordings/b.webm`,
    screenshots: [{ path: `${folder}/images/b.jpg` }],
    interview,
  };
  return { a, b };
}

describe("SKILLMARK-CHAINED-SHARED-PREFIX-MEDIA-WIPE", () => {
  it("declining one session keeps sibling sessions' media and the shared CV", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Victim_deadbeef`;
    const { a, b } = sharedFixture(folder);
    for (const k of [
      `${folder}/recordings/a.webm`,
      `${folder}/images/a.jpg`,
      `${folder}/recordings/part-${SID_A}-1700000000000-00001-5.webm`,
      `${folder}/recordings/b.webm`,
      `${folder}/images/b.jpg`,
      `${folder}/recordings/part-${SID_B}-1700000000000-00001-5.webm`,
      `${folder}/CV/resume.pdf`,
      `orgs/${ORG_B}/projects/p/candidates/x/images/foreign.jpg`,
    ]) {
      await put(k);
    }
    const db = w3Db({ sessions: [a, b], candidates: [] });
    const { applyMediaReview } = await import("@/lib/media-review");
    await applyMediaReview(db as any, SID_A, "declined");

    assert.equal(onDisk(`${folder}/recordings/a.webm`), false);
    assert.equal(onDisk(`${folder}/images/a.jpg`), false);
    assert.equal(onDisk(`${folder}/recordings/part-${SID_A}-1700000000000-00001-5.webm`), false);
    assert.equal(onDisk(`${folder}/recordings/b.webm`), true, "sibling recording survives");
    assert.equal(onDisk(`${folder}/images/b.jpg`), true, "sibling screenshot survives");
    assert.equal(onDisk(`${folder}/recordings/part-${SID_B}-1700000000000-00001-5.webm`), true);
    assert.equal(onDisk(`${folder}/CV/resume.pdf`), true, "shared CV survives");
    assert.equal(onDisk(`orgs/${ORG_B}/projects/p/candidates/x/images/foreign.jpg`), true, "foreign org object untouched");
    assert.ok(db.tables.sessions.find((s) => s.id === SID_A)?.mediaClearedAt);
  });

  it("a folder only this session uses is still wiped whole on decline", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Solo_cafebabe`;
    await put(`${folder}/recordings/solo.webm`);
    await put(`${folder}/CV/solo.pdf`);
    const solo = { id: SID_A, mediaStoragePrefix: folder, participantEmail: "solo@example.com", audioRecordingUrl: `${folder}/recordings/solo.webm`, interview };
    const db = w3Db({ sessions: [solo], candidates: [] });
    const { clearSessionMediaStorage } = await import("@/lib/media-review");
    await clearSessionMediaStorage(db as any, SID_A);
    assert.equal(onDisk(`${folder}/recordings/solo.webm`), false);
    assert.equal(onDisk(`${folder}/CV/solo.pdf`), false);
  });

  it("a walk-in sharing a victim's email folder cannot wipe the victim's CV", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Victim_0badf00d`;
    await put(`${folder}/CV/victim.pdf`);
    await put(`${folder}/recordings/walkin.webm`);
    const walkIn = { id: SID_A, mediaStoragePrefix: folder, participantEmail: "victim2@example.com", audioRecordingUrl: `${folder}/recordings/walkin.webm`, interview };
    const victimCandidate = { id: "cand-victim", email: "victim2@example.com", sessionId: null, interview: { projectId: PROJ } };
    const db = w3Db({ sessions: [walkIn], candidates: [victimCandidate] });
    const { clearSessionMediaStorage } = await import("@/lib/media-review");
    await clearSessionMediaStorage(db as any, SID_A);
    assert.equal(onDisk(`${folder}/recordings/walkin.webm`), false);
    assert.equal(onDisk(`${folder}/CV/victim.pdf`), true);
  });
});

describe("SKILLMARK-CANDIDATE-DELETION-RESIDUAL-MEDIA-AND-PREFLIGHT", () => {
  it("removes signed-URL audio, own recording parts and transcript backups in a shared folder, plus preflight rows", async () => {
    const folder = `orgs/${ORG}/projects/${PROJ}/candidates/Shared_11112222`;
    const audioKey = `${folder}/recordings/final-a.webm`;
    const { signFileToken } = await import("@/lib/storage");
    const tok = await signFileToken("recordings", audioKey, 60);
    const signed = `https://app.test/api/files/recordings/${audioKey.split("/").map(encodeURIComponent).join("/")}?token=${tok}`;
    await put(audioKey);
    await put(`${folder}/recordings/part-${SID_A}-1700000000000-00002-9.webm`);
    await put(`${folder}/recordings/transcript-backup-${SID_A}-1700000000000.json`, "{}");
    await put(`${folder}/recordings/transcript-backup-1600000000000.json`, JSON.stringify({ sessionId: SID_A }));
    await put(`${folder}/recordings/transcript-backup-1600000000001.json`, JSON.stringify({ sessionId: SID_B }));
    await put(`${folder}/recordings/b-final.webm`);

    const walkIn = { id: SID_A, mediaStoragePrefix: folder, participantEmail: null, audioRecordingUrl: signed, screenshots: [], interview };
    const sibling = { id: SID_B, mediaStoragePrefix: folder, audioRecordingUrl: `${folder}/recordings/b-final.webm`, interview };
    const db = w3Db({
      sessions: [walkIn, sibling],
      candidates: [],
      applications: [],
      session_preflight_events: [
        { id: "pf-1", sessionId: SID_A, candidateId: null, inviteToken: "tok", type: "link_opened" },
        { id: "pf-2", sessionId: SID_B, candidateId: null, inviteToken: "tok2", type: "link_opened" },
      ],
    });
    const { deleteSessionWithData } = await import("@/lib/candidate-data-deletion");
    await deleteSessionWithData(db as any, SID_A);

    assert.equal(onDisk(audioKey), false, "signed-URL audio removed");
    assert.equal(onDisk(`${folder}/recordings/part-${SID_A}-1700000000000-00002-9.webm`), false, "own parts removed");
    assert.equal(onDisk(`${folder}/recordings/transcript-backup-${SID_A}-1700000000000.json`), false);
    assert.equal(onDisk(`${folder}/recordings/transcript-backup-1600000000000.json`), false, "legacy own backup removed");
    assert.equal(onDisk(`${folder}/recordings/transcript-backup-1600000000001.json`), true, "sibling backup kept");
    assert.equal(onDisk(`${folder}/recordings/b-final.webm`), true, "sibling recording kept");
    assert.deepEqual(db.tables.session_preflight_events.map((r) => r.id), ["pf-2"]);
    assert.equal(db.tables.sessions.some((s) => s.id === SID_A), false);
  });
});

describe("SKILLMARK-ISOLATION-ANALYSIS-UNVALIDATED-MEDIA-URL-FALLBACK", () => {
  const SID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const USER = "user-1";

  async function summaryFor(session: Record<string, unknown>) {
    const db = w3Db({
      sessions: [{ id: SID, interview: { userId: USER, title: "T", objective: null, projectId: PROJ, project: { organizationId: ORG } }, messages: [], ...session }],
      organization_members: [{ organizationId: ORG, userId: USER, role: "ADMIN" }],
      organizations: [{ id: ORG, status: "ACTIVE" }],
      projects: [{ id: PROJ, organizationId: ORG }],
      project_members: [],
    });
    const { analysisRouter } = await import("@/server/routers/analysis");
    const caller = analysisRouter.createCaller({ supabase: db, user: { id: USER, email: "u@example.com" } } as any);
    return caller.getSessionSummary({ sessionId: SID });
  }

  it("drops screenshot / anti-cheating / audio URLs that cannot be re-signed", async () => {
    const out = await summaryFor({
      mediaStoragePrefix: `orgs/${ORG}/projects/${PROJ}/candidates/Own_aaaa0000`,
      audioRecordingUrl: `orgs/${ORG}/projects/other/candidates/Victim_1/recordings/v.webm`,
      screenshots: [
        { path: `orgs/${ORG}/projects/${PROJ}/candidates/session-${SID}/images/../../../../../../x.jpg`, url: "javascript:alert(1)", timestamp: "1", type: "camera" },
        { path: `orgs/${ORG}/projects/${PROJ}/candidates/Own_aaaa0000/images/ok.jpg`, url: "https://evil.example/ok.jpg", timestamp: "2", type: "camera" },
      ],
      antiCheatingLog: [{ type: "tab_switch", timestamp: 1, imageUrl: "https://evil.example/cam.jpg", screenImageUrl: "javascript:alert(2)" }],
    });
    assert.equal(out.audioRecordingUrl, null);
    assert.equal(out.screenshots?.length, 1);
    assert.match(out.screenshots![0].url, /^(https?:\/\/[^/]+)?\/api\/files\/screenshots\/orgs\/.*Own_aaaa0000.*\?token=/);
    const v = out.antiCheatingLog![0] as Record<string, unknown>;
    assert.equal(v.imageUrl, undefined);
    assert.equal(v.screenImageUrl, undefined);
  });

  it("report avatars only use server-signed /api/files URLs", async () => {
    const { buildReportData } = await import("@/lib/report-data");
    assert.equal(buildReportData({ screenshots: [{ type: "camera", url: "javascript:alert(1)" }] }).avatarUrl, null);
    assert.equal(buildReportData({ screenshots: [{ type: "camera", url: "https://evil.example/a.jpg" }] }).avatarUrl, null);
    assert.equal(
      buildReportData({ screenshots: [{ type: "camera", url: "/api/files/screenshots/orgs/o/a.jpg?token=t" }] }).avatarUrl,
      "/api/files/screenshots/orgs/o/a.jpg?token=t",
    );
  });
});
