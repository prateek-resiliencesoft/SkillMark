import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestTimestamp, startOfToday, timeRangeCutoff } from "@/lib/time-range";

describe("time range filter", () => {
  const now = new Date(2026, 10, 16, 10, 16, 0); // local time
  it("'today' starts at local midnight", () => {
    const d = timeRangeCutoff("today", now)!;
    assert.equal(d.getTime(), new Date(2026, 10, 16, 0, 0, 0, 0).getTime());
    assert.equal(startOfToday(now).getHours(), 0);
  });
  it("keeps the rolling ranges and all-time", () => {
    assert.equal(timeRangeCutoff("7d", now)!.getTime(), now.getTime() - 7 * 86_400_000);
    assert.equal(timeRangeCutoff("ALL", now), null);
  });
  it("newest-first value uses the latest timestamp", () => {
    assert.equal(latestTimestamp(null, "2026-11-10T00:00:00Z", "2026-11-12T00:00:00Z"), Date.parse("2026-11-12T00:00:00Z"));
    assert.equal(latestTimestamp(undefined, null), -1);
  });
});
