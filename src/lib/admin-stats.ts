/**
 * Pure helpers for the admin overview charts and the server condition card.
 * No I/O here so everything is unit-tested.
 */

/** YYYY-MM-DD for an instant in the given IANA time zone. */
export function dayKey(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type DailyPoint = { day: string; sessions: number; completed: number };

/** One point per day for the last `days` days (oldest first), zero-filled. */
export function dailySeries(
  rows: { createdAt: string; status: string }[],
  days: number,
  now: Date,
  timeZone: string,
): DailyPoint[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(new Date(now.getTime() - i * 86_400_000), timeZone);
    if (!keys.includes(k)) keys.push(k);
  }
  const map = new Map<string, DailyPoint>(
    keys.map((k) => [k, { day: k, sessions: 0, completed: 0 }]),
  );
  for (const r of rows) {
    const p = map.get(dayKey(r.createdAt, timeZone));
    if (!p) continue;
    p.sessions += 1;
    if (r.status === "COMPLETED") p.completed += 1;
  }
  return keys.map((k) => map.get(k)!);
}

export const SESSION_STATUSES = [
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
  "DISQUALIFIED",
] as const;

export function statusBreakdown(rows: { status: string }[]) {
  const counts: Record<string, number> = {};
  for (const s of SESSION_STATUSES) counts[s] = 0;
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return Object.entries(counts).map(([status, count]) => ({ status, count }));
}

/** Sessions per organization, largest first. */
export function usageByOrg(
  rows: { interviewId: string; status: string }[],
  orgOfInterview: Record<string, string | undefined>,
  orgName: Record<string, string | undefined>,
  limit = 8,
) {
  const agg = new Map<string, { sessions: number; completed: number }>();
  for (const r of rows) {
    const org = orgOfInterview[r.interviewId];
    if (!org) continue;
    const a = agg.get(org) ?? { sessions: 0, completed: 0 };
    a.sessions += 1;
    if (r.status === "COMPLETED") a.completed += 1;
    agg.set(org, a);
  }
  return Array.from(agg.entries())
    .map(([id, a]) => ({ id, name: orgName[id] ?? "Unknown", ...a }))
    .sort((x, y) => y.sessions - x.sessions || x.name.localeCompare(y.name))
    .slice(0, limit);
}

/* ---------------- /proc parsing (server condition) ---------------- */

/** Values from /proc/meminfo in bytes. */
export function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^(\w+(?:\(\w+\))?):\s+(\d+)(?:\s+kB)?/.exec(line);
    if (m) out[m[1]] = Number(m[2]) * (line.includes("kB") ? 1024 : 1);
  }
  return out;
}

/** Aggregate CPU jiffies from the first line of /proc/stat. */
export function parseProcStatCpu(text: string): { idle: number; total: number } | null {
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const idle = nums[3] + (nums[4] ?? 0);
  const total = nums.reduce((a, b) => a + b, 0);
  return { idle, total };
}

export function cpuPercent(
  a: { idle: number; total: number },
  b: { idle: number; total: number },
): number | null {
  const dt = b.total - a.total;
  if (dt <= 0) return null;
  const busy = dt - (b.idle - a.idle);
  return Math.min(100, Math.max(0, (busy / dt) * 100));
}

/** cgroup v2 memory.max: "max" means no limit. */
export function parseCgroupLimit(text: string | null): number | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || t === "max") return null;
  const n = Number(t);
  // cgroup v1 reports ~2^63 for "unlimited".
  return Number.isFinite(n) && n > 0 && n < 2 ** 60 ? n : null;
}

export type Level = "ok" | "warn" | "critical";

export function levelFor(percent: number | null, warn = 75, critical = 90): Level {
  if (percent == null) return "ok";
  if (percent >= critical) return "critical";
  if (percent >= warn) return "warn";
  return "ok";
}
