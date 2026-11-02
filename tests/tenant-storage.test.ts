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
