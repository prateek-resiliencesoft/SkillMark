import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HEARTBEAT_GRACE_MS, isHeartbeatStale, isLinkConsumed } from "@/lib/session-link";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isHeartbeatStale", () => {
  it("is false before the interview begins (onboarding reloads are fine)", () => {
    assert.equal(isHeartbeatStale({ status: "IN_PROGRESS", interviewBeganAt: null }, NOW), false);
  });

  it("is false while beats are fresh", () => {
    assert.equal(
      isHeartbeatStale(
        { status: "IN_PROGRESS", interviewBeganAt: ago(60_000), lastHeartbeatAt: ago(5_000) },
        NOW,
      ),
      false,
    );
  });

  it("is true once the last beat is older than the grace window", () => {
    assert.equal(
      isHeartbeatStale(
        { status: "IN_PROGRESS", interviewBeganAt: ago(60_000), lastHeartbeatAt: ago(HEARTBEAT_GRACE_MS + 1) },
        NOW,
      ),
      true,
    );
  });

  it("falls back to the begin time when no beat was ever recorded", () => {
    assert.equal(
      isHeartbeatStale({ status: "IN_PROGRESS", interviewBeganAt: ago(HEARTBEAT_GRACE_MS + 1) }, NOW),
      true,
    );
  });

  it("ignores sessions that already ended", () => {
    assert.equal(
      isHeartbeatStale(
        { status: "COMPLETED", interviewBeganAt: ago(999_999), lastHeartbeatAt: ago(999_999) },
        NOW,
      ),
      false,
    );
  });
});

describe("isLinkConsumed", () => {
  it("treats ended sessions as consumed", () => {
    for (const s of ["COMPLETED", "ABANDONED", "DISQUALIFIED"]) assert.equal(isLinkConsumed(s), true);
  });
  it("keeps open sessions usable", () => {
    assert.equal(isLinkConsumed("IN_PROGRESS"), false);
    assert.equal(isLinkConsumed(undefined), false);
  });
});
