/**
 * Layered quotas for the shared code-runner key. Session ids are cheap to mint, so a
 * per-session window alone can be reset by rotating them; the org, user and global
 * buckets (and the concurrency cap) bound total upstream spend regardless.
 */
export type CodeRunLimits = Record<
  "perSessionPerMinute" | "perSessionTotal" | "perUserPerMinute" | "perOrgPerMinute" | "globalPerMinute" | "maxConcurrent",
  number
>;

export const CODE_RUN_LIMITS: Readonly<CodeRunLimits> = {
  perSessionPerMinute: 12,
  perSessionTotal: 300,
  perUserPerMinute: 12,
  perOrgPerMinute: 60,
  globalPerMinute: 120,
  maxConcurrent: 8,
};

const MINUTE = 60_000;
const SESSION_TOTAL_WINDOW_MS = 6 * 60 * MINUTE;

type Bucket = { key: string; max: number; windowMs: number };

export type CodeRunScope = { sessionId?: string | null; userId?: string | null; organizationId?: string | null };

export function createCodeRunLimiter(limits: Readonly<CodeRunLimits> = CODE_RUN_LIMITS, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let running = 0;

  const bucketsFor = (scope: CodeRunScope): Bucket[] => {
    const b: Bucket[] = [{ key: "global", max: limits.globalPerMinute, windowMs: MINUTE }];
    if (scope.sessionId) {
      b.push({ key: `s:${scope.sessionId}`, max: limits.perSessionPerMinute, windowMs: MINUTE });
      b.push({ key: `st:${scope.sessionId}`, max: limits.perSessionTotal, windowMs: SESSION_TOTAL_WINDOW_MS });
    }
    if (scope.userId) b.push({ key: `u:${scope.userId}`, max: limits.perUserPerMinute, windowMs: MINUTE });
    if (scope.organizationId) b.push({ key: `o:${scope.organizationId}`, max: limits.perOrgPerMinute, windowMs: MINUTE });
    return b;
  };

  return {
    /**
     * Reserves one run across every applicable bucket, or returns the bucket that is full.
     * Call `release()` when the run finishes.
     */
    acquire(scope: CodeRunScope): { ok: true; release: () => void } | { ok: false; reason: string } {
      if (running >= limits.maxConcurrent) return { ok: false, reason: "concurrency" };
      const t = now();
      const buckets = bucketsFor(scope);
      const recent = buckets.map((b) => (hits.get(b.key) ?? []).filter((x) => t - x < b.windowMs));
      const full = buckets.findIndex((b, i) => recent[i].length >= b.max);
      if (full >= 0) {
        hits.set(buckets[full].key, recent[full]);
        return { ok: false, reason: buckets[full].key.split(":")[0] };
      }
      buckets.forEach((b, i) => {
        recent[i].push(t);
        hits.set(b.key, recent[i]);
      });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (!v.some((x) => t - x < SESSION_TOTAL_WINDOW_MS)) hits.delete(k);
      }
      running++;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (!released) running--;
          released = true;
        },
      };
    },
  };
}

export type CodeRunSessionRow = {
  id: string;
  status?: string | null;
  interviewBeganAt?: string | null;
  capabilityRequired?: boolean | null;
};

/** Candidates may run code only in a live session whose interview has actually begun. */
export function codeRunSessionAllowed(s: CodeRunSessionRow | null | undefined): boolean {
  return !!s && s.status === "IN_PROGRESS" && !!s.interviewBeganAt;
}
