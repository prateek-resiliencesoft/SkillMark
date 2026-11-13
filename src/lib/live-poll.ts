/**
 * Dashboard lists don't refetch on focus/mount (see providers.tsx), so a
 * session that finishes while the page is open would keep saying "In progress".
 * Poll only while something is live or a report is still being built.
 */
export const LIVE_POLL_MS = 15_000;

export function hasLiveSession(data: unknown): boolean {
  if (data == null) return false;
  try {
    const json = JSON.stringify(data);
    return (
      json.includes('"status":"IN_PROGRESS"') ||
      json.includes('"reportStatus":"PENDING"') ||
      json.includes('"reportStatus":"GENERATING"')
    );
  } catch {
    return false;
  }
}

export function livePollInterval(data: unknown): number | false {
  return hasLiveSession(data) ? LIVE_POLL_MS : false;
}
