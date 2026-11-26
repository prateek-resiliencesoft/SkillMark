import {
  defaultPlatformSettings,
  parseDefaultFeatureFlags,
  parseInstanceSettings,
  parsePlanCatalog,
  type PlatformSettingsBundle,
} from "@/lib/platform-settings";
import { limitsFromCatalog } from "@/lib/billing/catalog";
import type { Context } from "./context";

type Db = Context["supabase"];

/** Load all platform settings with hardcoded fallbacks. */
export async function loadPlatformSettings(
  supabase: Db,
): Promise<PlatformSettingsBundle> {
  const defaults = defaultPlatformSettings();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value");

  // Table may be missing before migration — fall back silently.
  if (error || !data) return defaults;

  const map = new Map(data.map((r) => [r.key as string, r.value]));
  const planCatalog = parsePlanCatalog(
    map.get("planCatalog"),
    map.get("planLimits"),
  );

  return {
    instance: parseInstanceSettings(map.get("instance")),
    planCatalog,
    planLimits: limitsFromCatalog(planCatalog),
    defaultFeatureFlags: parseDefaultFeatureFlags(
      map.get("defaultFeatureFlags"),
    ),
  };
}

export async function upsertPlatformSetting(
  supabase: Db,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase.from("platform_settings").upsert(
    {
      key,
      value: value as never,
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
}
