import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIVE_DURATION_CAP_SECONDS, listDurationSeconds } from "@/lib/session-activity";

const T0 = "2026-11-23T07:00:00.000Z";
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

describe("listDurationSeconds", () => {
  it("is empty without a session or before the session row exists", () => {
    assert.equal(listDurationSeconds(null), null);
    assert.equal(listDurationSeconds({ status: "NOT_STARTED", startedAt: T0, lastActivityAt: at(5) }), null);
  });

  it("does not count a link left open in setup (heartbeats keep moving)", () => {
    // Anant: Setting up, tab open for 5h -> was 304m
    assert.equal(
      listDurationSeconds({ status: "IN_PROGRESS", startedAt: T0, lastActivityAt: at(1), lastHeartbeatAt: at(304) }),
      null,
    );
    // Shabda: quiet setup shown as Not Started -> was 46m
    assert.equal(listDurationSeconds({ status: "IN_PROGRESS", startedAt: T0, lastHeartbeatAt: at(46) }), null);
    // Abhay: opened then left -> was 1s
    assert.equal(
      listDurationSeconds({ status: "IN_PROGRESS", startedAt: T0, lastActivityAt: new Date(new Date(T0).getTime() + 1000).toISOString() }),
      null,
    );
  });

  it("ignores a stored duration or recording on a session that has not begun", () => {
    assert.equal(listDurationSeconds({ status: "IN_PROGRESS", startedAt: T0, audioDuration: 30, totalDurationSeconds: 40 }), null);
  });

  it("shows live elapsed from interviewBeganAt, not from link open", () => {
    assert.equal(
      listDurationSeconds({ status: "IN_PROGRESS", startedAt: T0, interviewBeganAt: at(20), lastHeartbeatAt: at(32) }),
      12 * 60,
    );
    assert.equal(
      listDurationSeconds({ status: "IN_PROGRESS", interviewBeganAt: T0, lastActivityAt: at(10) }, at(14)),
      14 * 60,
    );
  });

  it("caps a running interview whose tab was left open", () => {
    assert.equal(
      listDurationSeconds({ status: "IN_PROGRESS", interviewBeganAt: T0, lastHeartbeatAt: at(60 * 10) }),
      LIVE_DURATION_CAP_SECONDS,
    );
  });

  it("uses the real duration once ended", () => {
    assert.equal(listDurationSeconds({ status: "COMPLETED", totalDurationSeconds: 900, startedAt: T0 }), 900);
    assert.equal(listDurationSeconds({ status: "COMPLETED", interviewBeganAt: at(5), completedAt: at(25) }), 1200);
    assert.equal(listDurationSeconds({ status: "ABANDONED", audioDuration: 418.6 }), 419);
  });

  it("is empty for sessions closed as never started", () => {
    assert.equal(
      listDurationSeconds({ status: "ABANDONED", endReason: "NEVER_STARTED", startedAt: T0, lastHeartbeatAt: at(90) }),
      null,
    );
  });
});
