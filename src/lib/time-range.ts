/** Start of the current local day (the browser's time zone, e.g. Asia/Calcutta). */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

const RANGE_MS: Record<string, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

/** Lower bound for a time-range filter value ("today", "7d", …); null = all time. */
export function timeRangeCutoff(value: string, now: Date = new Date()): Date | null {
  if (value === "today") return startOfToday(now);
  const ms = RANGE_MS[value];
  return ms ? new Date(now.getTime() - ms) : null;
}

/** Newest-first sort value: the latest of the given timestamps (ms), or -1. */
export function latestTimestamp(...values: (string | null | undefined)[]): number {
  let best = -1;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return best;
}
