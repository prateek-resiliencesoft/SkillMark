import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  objectPathFromSignedUrl,
  pathBelongsToOrganization,
  pathBelongsToSession,
  tenantApplicationObjectPath,
  tenantSessionObjectPath,
} from "@/lib/tenant-storage";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const SESSION = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("tenantSessionObjectPath", () => {
  it("prefixes org and session folders", () => {
    assert.equal(
      tenantSessionObjectPath(ORG_A, SESSION, "clip.webm"),
      `org/${ORG_A}/sessions/${SESSION}/clip.webm`,
    );
  });
});

describe("tenantApplicationObjectPath", () => {
  it("keeps application files under the org namespace", () => {
    assert.equal(
      tenantApplicationObjectPath(ORG_A, "app_abc", "resume", "0-cv.pdf"),
      `org/${ORG_A}/applications/app_abc/resume/0-cv.pdf`,
    );
  });
});

describe("pathBelongsToOrganization", () => {
  it("accepts org/, orgs/, and legacy org-root paths", () => {
    assert.equal(
      pathBelongsToOrganization(`org/${ORG_A}/sessions/${SESSION}/a.webm`, ORG_A),
      true,
    );
    assert.equal(
      pathBelongsToOrganization(
        `orgs/${ORG_A}/projects/p1/candidates/c1/cv/0.pdf`,
        ORG_A,
      ),
      true,
    );
    assert.equal(
      pathBelongsToOrganization(`${ORG_A}/app_x/resume/0.pdf`, ORG_A),
      true,
    );
    assert.equal(
      pathBelongsToOrganization(`org/${ORG_B}/sessions/${SESSION}/a.webm`, ORG_A),
      false,
    );
    assert.equal(
      pathBelongsToOrganization(
        `orgs/${ORG_B}/projects/p1/candidates/c1/cv/0.pdf`,
        ORG_A,
      ),
      false,
    );
  });
});

describe("pathBelongsToSession", () => {
  it("accepts new tenant paths for the matching session", () => {
    assert.equal(
      pathBelongsToSession(
        `org/${ORG_A}/sessions/${SESSION}/shot.jpg`,
        SESSION,
        ORG_A,
      ),
      true,
    );
  });

  it("accepts legacy sessionId/filename paths", () => {
    assert.equal(
      pathBelongsToSession(`${SESSION}/shot.jpg`, SESSION, ORG_A),
      true,
    );
  });

  it("rejects another organization's media", () => {
    assert.equal(
      pathBelongsToSession(
        `org/${ORG_B}/sessions/${SESSION}/shot.jpg`,
        SESSION,
        ORG_A,
      ),
      false,
    );
  });

  it("rejects another session under the same org", () => {
    assert.equal(
      pathBelongsToSession(
        `org/${ORG_A}/sessions/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/shot.jpg`,
        SESSION,
        ORG_A,
      ),
      false,
    );
  });

  it("accepts orgs/ candidate media for the matching org", () => {
    assert.equal(
      pathBelongsToSession(
        `orgs/${ORG_A}/projects/p1/candidates/session-${SESSION}/recordings/a.webm`,
        SESSION,
        ORG_A,
      ),
      true,
    );
    assert.equal(
      pathBelongsToSession(
        `orgs/${ORG_B}/projects/p1/candidates/session-${SESSION}/recordings/a.webm`,
        SESSION,
        ORG_A,
      ),
      false,
    );
  });
});

describe("objectPathFromSignedUrl", () => {
  it("parses /api/files signed URLs", () => {
    const path = `org/${ORG_A}/sessions/${SESSION}/clip.webm`;
    const url = `https://app.example/api/files/recordings/${path.split("/").map(encodeURIComponent).join("/")}?token=abc`;
    assert.equal(objectPathFromSignedUrl("recordings", url), path);
  });

  it("returns bare paths unchanged", () => {
    assert.equal(
      objectPathFromSignedUrl("screenshots", `${SESSION}/cam.jpg`),
      `${SESSION}/cam.jpg`,
    );
  });
});

import {
  candidateFolderSlug,
  candidateMediaPrefix,
  mediaObjectKey,
  parseMediaKey,
} from "@/lib/storage-paths";

describe("folderized candidate storage paths", () => {
  it("structures folders as candidateName/recordings, /images, /CV", () => {
    const slug = candidateFolderSlug({
      candidateId: "12345678-abcd-1111-2222-333333333333",
      candidateName: "John Doe",
    });
    assert.equal(slug, "John_Doe_12345678");

    const recKey = mediaObjectKey({
      orgId: "org-1",
      projectId: "proj-1",
      candidateId: "12345678-abcd-1111-2222-333333333333",
      candidateName: "John Doe",
      kind: "recordings",
      fileName: "interview.m4a",
    });
    assert.equal(
      recKey,
      "orgs/org-1/projects/proj-1/candidates/John_Doe_12345678/recordings/interview.m4a",
    );

    const imgKey = mediaObjectKey({
      orgId: "org-1",
      projectId: "proj-1",
      candidateId: "12345678-abcd-1111-2222-333333333333",
      candidateName: "John Doe",
      kind: "screenshots",
      fileName: "capture-1.jpg",
    });
    assert.equal(
      imgKey,
      "orgs/org-1/projects/proj-1/candidates/John_Doe_12345678/images/capture-1.jpg",
    );

    const cvKey = mediaObjectKey({
      orgId: "org-1",
      projectId: "proj-1",
      candidateId: "12345678-abcd-1111-2222-333333333333",
      candidateName: "John Doe",
      kind: "cv",
      fileName: "resume.pdf",
    });
    assert.equal(
      cvKey,
      "orgs/org-1/projects/proj-1/candidates/John_Doe_12345678/CV/resume.pdf",
    );
  });

  it("uses one folder per person when the email is known", () => {
    const a = candidateFolderSlug({
      candidateId: "aaaaaaaa-1111-2222-3333-444444444444",
      candidateName: "Sayyad Moin Ali",
      candidateEmail: "AliSayyadMoin@gmail.com ",
    });
    const b = candidateFolderSlug({
      candidateId: "bbbbbbbb-1111-2222-3333-444444444444",
      candidateName: "Sayyad Moin Ali",
      candidateEmail: "alisayyadmoin@gmail.com",
    });
    assert.equal(a, b);
    assert.match(a, /^Sayyad_Moin_Ali_[0-9a-f]{8}$/);
  });

  it("reuses an assigned session prefix and parses keys back", () => {
    const key = mediaObjectKey({
      orgId: "org-1",
      projectId: "proj-1",
      candidateId: "x",
      kind: "recordings",
      fileName: "a.m4a",
      prefix: "orgs/org-1/projects/proj-1/candidates/Old_Folder_deadbeef",
    });
    assert.equal(key, "orgs/org-1/projects/proj-1/candidates/Old_Folder_deadbeef/recordings/a.m4a");
    const parsed = parseMediaKey(key);
    assert.equal(parsed.folderSlug, "Old_Folder_deadbeef");
    assert.equal(parsed.kind, "recordings");
    assert.equal(parsed.folderPrefix, "orgs/org-1/projects/proj-1/candidates/Old_Folder_deadbeef");
  });
});
