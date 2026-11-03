/**
 * Which UptimeRobot monitors appear on landing + in-app /status.
 * Stored in platform_settings key `uptime`.
 *
 * Until an admin toggles/creates with an explicit flag (`seeded: true`),
 * public = heuristic (URL/name does not contain `/admin`).
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type UptimeVisibility = {
  /** Authoritative allowlist once seeded */
  publicIds: number[];
  /** false = use /admin heuristic until first explicit change */
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

export async function loadUptimeVisibility(): Promise<UptimeVisibility> {
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("value")
    .eq("key", "uptime")
    .maybeSingle();
  if (error || !data) return defaultUptimeVisibility();
  return parseUptimeVisibility(data.value);
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

/** Seed allowlist from heuristic audiences if not yet explicit. */
export async function seedUptimeVisibilityIfNeeded(
  heuristicPublicIds: number[],
  updatedBy: string,
): Promise<UptimeVisibility> {
  const current = await loadUptimeVisibility();
  if (current.seeded) return current;
  return saveUptimeVisibility(
    { publicIds: heuristicPublicIds, seeded: true },
    updatedBy,
  );
}

export function isMonitorPublic(
  monitorId: number,
  heuristicPublic: boolean,
  vis: UptimeVisibility,
): boolean {
  if (vis.seeded) return vis.publicIds.includes(monitorId);
  return heuristicPublic;
}
