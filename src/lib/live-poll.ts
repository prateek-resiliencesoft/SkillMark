/**
 * Dashboard lists don't refetch on focus/mount (see providers.tsx), so a
 * session that finishes while the page is open would keep saying "In progress".
 * Poll only while something is live or a report is still being built.
 */
export const LIVE_POLL_MS = 20_000;

const LIVE_STATUS = new Set(["IN_PROGRESS", "PENDING", "GENERATING"]);

function walkForLive(value: unknown, depth: number): boolean {
  if (value == null || depth > 6) return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkForLive(item, depth + 1)) return true;
    }
    return false;
  }
  if (typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.status === "string" && LIVE_STATUS.has(obj.status)) return true;
  if (typeof obj.reportStatus === "string" && LIVE_STATUS.has(obj.reportStatus)) return true;
  // Common list envelopes — don't scan every field (insights blobs are huge).
  for (const key of ["candidates", "items", "rows", "sessions", "data"] as const) {
    if (key in obj && walkForLive(obj[key], depth + 1)) return true;
  }
  if ("session" in obj && walkForLive(obj.session, depth + 1)) return true;
  return false;
}

export function hasLiveSession(data: unknown): boolean {
  return walkForLive(data, 0);
}

export function livePollInterval(data: unknown): number | false {
  return hasLiveSession(data) ? LIVE_POLL_MS : false;
}
