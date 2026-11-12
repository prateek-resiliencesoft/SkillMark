import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PREFLIGHT_STALE_MS,
  buildPreflightTimeline,
  formatSessionStatusLabel,
  isPreflightStale,
  preflightStuckStep,
  shouldDedupePreflightEvent,
  type PreflightEvent,
} from "@/lib/preflight";
import { needsFreshInviteLink } from "@/lib/session-link";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isPreflightStale", () => {
  it("is false before a session exists or after the interview begins", () => {
    assert.equal(isPreflightStale({ status: "IN_PROGRESS", interviewBeganAt: ago(1_000), lastActivityAt: ago(60_000) }, NOW), false);
    assert.equal(isPreflightStale({ status: "COMPLETED", lastActivityAt: ago(DEFAULT_PREFLIGHT_STALE_MS * 2) }, NOW), false);
  });

  it("is false while the candidate is still setting up within the window", () => {
    assert.equal(
      isPreflightStale(
        { status: "IN_PROGRESS", interviewBeganAt: null, lastActivityAt: ago(DEFAULT_PREFLIGHT_STALE_MS - 1_000) },
        NOW,
      ),
      false,
    );
  });

  it("is true when setup has been quiet longer than the stale window", () => {
    assert.equal(
      isPreflightStale(
        { status: "IN_PROGRESS", interviewBeganAt: null, lastActivityAt: ago(DEFAULT_PREFLIGHT_STALE_MS + 1) },
        NOW,
      ),
      true,
    );
  });

  it("falls back to startedAt / createdAt when lastActivityAt is missing", () => {
    assert.equal(
      isPreflightStale({ status: "IN_PROGRESS", interviewBeganAt: null, startedAt: ago(DEFAULT_PREFLIGHT_STALE_MS + 1) }, NOW),
      true,
    );
  });
});

describe("formatSessionStatusLabel", () => {
  it("keeps completed / abandoned / not started labels", () => {
    assert.equal(formatSessionStatusLabel(null, NOW), "Not Started");
    assert.equal(formatSessionStatusLabel({ status: "COMPLETED" }, NOW), "Completed");
    assert.equal(formatSessionStatusLabel({ status: "ABANDONED" }, NOW), "Abandoned");
  });

  it("does not call a pre-interview session In Progress", () => {
    assert.equal(
      formatSessionStatusLabel({ status: "IN_PROGRESS", interviewBeganAt: null, preflightStep: "link_opened", lastActivityAt: ago(1_000) }, NOW),
      "Opened link",
    );
    assert.equal(
      formatSessionStatusLabel({ status: "IN_PROGRESS", interviewBeganAt: null, preflightStep: "camera_permission", lastActivityAt: ago(1_000) }, NOW),
      "Setting up",
    );
    assert.equal(
      formatSessionStatusLabel({ status: "IN_PROGRESS", interviewBeganAt: ago(5_000), lastActivityAt: ago(1_000) }, NOW),
      "In Progress",
    );
  });

  it("labels a stale setup session Abandoned so a new link can be sent", () => {
    assert.equal(
      formatSessionStatusLabel(
        { status: "IN_PROGRESS", interviewBeganAt: null, preflightStep: "mic_check", lastActivityAt: ago(DEFAULT_PREFLIGHT_STALE_MS + 5_000) },
        NOW,
      ),
      "Abandoned",
    );
  });
});

describe("needsFreshInviteLink", () => {
  it("is true when pre-interview activity has gone stale", () => {
    assert.equal(
      needsFreshInviteLink({
        session: {
          status: "IN_PROGRESS",
          interviewBeganAt: null,
          lastActivityAt: ago(DEFAULT_PREFLIGHT_STALE_MS + 1),
        },
        nowMs: NOW,
      }),
      true,
    );
  });

  it("is false while the candidate is still in setup with recent activity", () => {
    assert.equal(
      needsFreshInviteLink({
        session: {
          status: "IN_PROGRESS",
          interviewBeganAt: null,
          lastActivityAt: ago(60_000),
        },
        nowMs: NOW,
      }),
      false,
    );
  });
});

describe("shouldDedupePreflightEvent", () => {
  it("keeps a single link_opened / consent / interview_started", () => {
    const last = { status: "done", createdAt: ago(1_000) };
    assert.equal(shouldDedupePreflightEvent("link_opened", "done", last, NOW), true);
    assert.equal(shouldDedupePreflightEvent("consent_accepted", "done", last, NOW), true);
    assert.equal(shouldDedupePreflightEvent("interview_started", "done", last, NOW), true);
  });

  it("allows mic_check failures after a short gap so retries are counted", () => {
    assert.equal(
      shouldDedupePreflightEvent("mic_check", "failed", { status: "failed", createdAt: ago(5_000) }, NOW),
      false,
    );
    assert.equal(
      shouldDedupePreflightEvent("mic_check", "failed", { status: "failed", createdAt: ago(500) }, NOW),
      true,
    );
  });

  it("drops an identical permission status but keeps a later change", () => {
    assert.equal(
      shouldDedupePreflightEvent("camera_permission", "granted", { status: "granted", createdAt: ago(1_000) }, NOW),
      true,
    );
    assert.equal(shouldDedupePreflightEvent("camera_permission", "granted", null, NOW), false);
  });
});

describe("buildPreflightTimeline", () => {
  const events: PreflightEvent[] = [
    { type: "link_opened", status: "done", createdAt: ago(120_000), inviteToken: "tok-a" },
    { type: "consent_accepted", status: "done", createdAt: ago(110_000), inviteToken: "tok-a" },
    { type: "camera_permission", status: "granted", createdAt: ago(90_000), inviteToken: "tok-a" },
    { type: "mic_check", status: "failed", createdAt: ago(80_000), inviteToken: "tok-a" },
    { type: "mic_check", status: "failed", createdAt: ago(70_000), inviteToken: "tok-a" },
    { type: "mic_check", status: "passed", createdAt: ago(60_000), inviteToken: "tok-a" },
    { type: "link_opened", status: "done", createdAt: ago(999_000), inviteToken: "tok-old" },
  ];

  it("fills steps in order, scopes to the current invite token, and counts mic retries", () => {
    const items = buildPreflightTimeline(events, "tok-a");
    assert.equal(items[0].ok, true);
    assert.equal(items[0].at, ago(120_000));
    assert.equal(items.find((i) => i.type === "mic_check")?.ok, true);
    assert.equal(items.find((i) => i.type === "mic_check")?.retries, 2);
    assert.equal(items.find((i) => i.type === "screen_share")?.pending, true);
    assert.ok(!items.some((i) => i.at === ago(999_000)));
  });

  it("reports the next unfinished step as the stuck step", () => {
    const items = buildPreflightTimeline(events, "tok-a");
    const stuck = preflightStuckStep(items);
    assert.equal(stuck?.type, "photo_captured");
  });

  it("prefers a failed/denied step over the next pending one", () => {
    const items = buildPreflightTimeline(
      [
        { type: "link_opened", status: "done", createdAt: ago(20_000) },
        { type: "camera_permission", status: "denied", createdAt: ago(10_000) },
      ],
      null,
    );
    assert.equal(preflightStuckStep(items)?.type, "camera_permission");
  });
});
