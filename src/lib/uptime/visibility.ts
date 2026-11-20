/**
 * Which UptimeRobot monitors appear on landing + in-app /status.
 * Stored in platform_settings key `uptime`.
 *
 * Fails closed: only monitors an admin explicitly marked public are shown. Missing
 * settings mean nothing is public; a read error throws so callers never fall back to
 * a name/URL heuristic (and admin writes never overwrite the list from a failed read).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type UptimeVisibility = {
  /** Authoritative allowlist once seeded */
  publicIds: number[];
  /** Legacy flag; visibility is always the explicit allowlist. */
  seeded: boolean;
};

export function defaultUptimeVisibility(): UptimeVisibility {
  return { publicIds: [], seeded: false };
}

export function parseUptimeVisibility(raw: unknown): UptimeVisibility {
  const base = defaultUptimeVisibility();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const ids = Array.isArray(o.publicIds)
    ? o.publicIds
        .map((x) => (typeof x === "number" ? x : Number(x)))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.floor(n))
    : [];
  return {
    publicIds: [...new Set(ids)],
    seeded: o.seeded === true,
  };
}

/** What public endpoints use when the allowlist cannot be read. */
export const FAIL_CLOSED_UPTIME_VISIBILITY: UptimeVisibility = Object.freeze({ publicIds: [], seeded: true }) as UptimeVisibility;

export async function loadUptimeVisibility(): Promise<UptimeVisibility> {
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("value")
    .eq("key", "uptime")
    .maybeSingle();
  if (error) throw new Error(`Could not load uptime visibility: ${error.message}`);
  if (!data) return { publicIds: [], seeded: true };
  return { ...parseUptimeVisibility(data.value), seeded: true };
}

export async function saveUptimeVisibility(
  value: UptimeVisibility,
  updatedBy: string,
): Promise<UptimeVisibility> {
  const next: UptimeVisibility = {
    publicIds: [...new Set(value.publicIds.map((n) => Math.floor(n)))],
    seeded: true,
  };
  const { error } = await supabaseAdmin.from("platform_settings").upsert(
    {
      key: "uptime",
      value: next as never,
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
  return next;
}

/**
 * Current explicit allowlist. Heuristic ids are intentionally not persisted: a monitor
 * becomes public only when an admin marks it so.
 */
export async function seedUptimeVisibilityIfNeeded(
  _heuristicPublicIds: number[],
  _updatedBy: string,
): Promise<UptimeVisibility> {
  return loadUptimeVisibility();
}

export function isMonitorPublic(
  monitorId: number,
  _heuristicPublic: boolean,
  vis: UptimeVisibility,
): boolean {
  return vis.publicIds.includes(monitorId);
}
