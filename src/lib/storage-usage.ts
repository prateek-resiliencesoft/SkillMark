/**
 * Live storage usage for the server disk + the super-admin cap gate.
 * Server-only. Installed lazily by storage.ts on the first local upload.
 *
 * Used bytes come from a walk of STORAGE_DIR (at most every 5 min) kept
 * current between walks by the +/- deltas storage.ts reports on write/delete.
 */
import { createLogger } from "@/lib/logger";
import {
  capLevelRank,
  decideUpload,
  storageCapLevel,
  STORAGE_CAP_MESSAGES,
  type StorageCapLevel,
} from "@/lib/storage-cap";
import {
  getLocalDiskSpace,
  listAllObjects,
  onLocalUsageChanged,
  setUploadGate,
} from "@/lib/storage";

const log = createLogger("storage-usage");

const USAGE_TTL_MS = 5 * 60 * 1000;
const QUOTA_TTL_MS = 60 * 1000;

let usage: { bytes: number; at: number } | null = null;
let usageWalk: Promise<number> | null = null;
let quota: { bytes: number | null; at: number } | null = null;

async function db() {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin;
}

/** Bytes used on the server disk by stored media (cached). */
export async function getLocalUsedBytes(opts: { fresh?: boolean } = {}): Promise<number> {
  if (!opts.fresh && usage && Date.now() - usage.at < USAGE_TTL_MS) return usage.bytes;
  if (!usageWalk) {
    usageWalk = listAllObjects("")
      .then((items) => {
        const bytes = items.reduce((n, i) => n + i.size, 0);
        usage = { bytes, at: Date.now() };
        return bytes;
      })
      .finally(() => {
        usageWalk = null;
      });
  }
  return usageWalk;
}

/** Super-admin cap in bytes (platform_settings.storageQuota), cached for a minute. */
export async function getStorageQuotaBytes(opts: { fresh?: boolean } = {}): Promise<number | null> {
  if (!opts.fresh && quota && Date.now() - quota.at < QUOTA_TTL_MS) return quota.bytes;
  let bytes: number | null = null;
  try {
    const { data } = await (await db())
      .from("platform_settings")
      .select("value")
      .eq("key", "storageQuota")
      .maybeSingle();
    const v = (data?.value as { bytes?: unknown } | null)?.bytes;
    bytes = typeof v === "number" && v > 0 ? v : null;
  } catch (err) {
    log.warn("Could not read the storage cap; uploads are not capped until it loads", err);
    // Keep the last known cap rather than dropping enforcement on a blip.
    bytes = quota?.bytes ?? null;
  }
  quota = { bytes, at: Date.now() };
  return bytes;
}

export function invalidateStorageQuotaCache(): void {
  quota = null;
}

export type StorageCapStatus = {
  level: StorageCapLevel;
  usedBytes: number;
  quotaBytes: number | null;
  percent: number | null;
};

export async function getStorageCapStatus(opts: { fresh?: boolean } = {}): Promise<StorageCapStatus> {
  const [usedBytes, quotaBytes] = await Promise.all([getLocalUsedBytes(opts), getStorageQuotaBytes(opts)]);
  return {
    level: storageCapLevel(usedBytes, quotaBytes),
    usedBytes,
    quotaBytes,
    percent: quotaBytes ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : null,
  };
}

/**
 * Record the first time usage crosses a warning level (one audit entry per
 * crossing; going back down re-arms it). Stored in platform_settings so a
 * restart does not log the same crossing again.
 */
let lastNotedLevel: StorageCapLevel | null = null;
export async function noteStorageCapLevel(status: StorageCapStatus): Promise<void> {
  if (status.level === lastNotedLevel) return;
  try {
    const sb = await db();
    const { data } = await sb.from("platform_settings").select("value").eq("key", "storageCapAlert").maybeSingle();
    const stored = ((data?.value as { level?: StorageCapLevel } | null)?.level ?? "ok") as StorageCapLevel;
    lastNotedLevel = status.level;
    if (stored === status.level) return;
    await sb.from("platform_settings").upsert(
      { key: "storageCapAlert", value: { level: status.level, at: new Date().toISOString() }, updatedAt: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (capLevelRank(status.level) > capLevelRank(stored)) {
      await sb.from("platform_audit_logs").insert({
        actorId: null,
        action: "storage.cap_level",
        targetType: "storage",
        meta: { level: status.level, usedBytes: status.usedBytes, quotaBytes: status.quotaBytes, percent: status.percent },
      });
      log.warn(`Storage usage reached ${status.level} (${status.percent}% of the cap)`);
    }
  } catch {
    /* warning bookkeeping only */
  }
}

async function gate(bytes: number, opts: { liveSession: boolean }): Promise<string | null> {
  const [usedBytes, quotaBytes, disk] = await Promise.all([
    getLocalUsedBytes(),
    getStorageQuotaBytes(),
    getLocalDiskSpace(),
  ]);
  const decision = decideUpload({
    usedBytes,
    quotaBytes,
    incomingBytes: bytes,
    liveSession: opts.liveSession,
    diskFreeBytes: disk?.freeBytes ?? null,
  });
  void noteStorageCapLevel({
    level: storageCapLevel(usedBytes + (decision.allowed ? bytes : 0), quotaBytes),
    usedBytes,
    quotaBytes,
    percent: quotaBytes ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : null,
  });
  if (decision.allowed) return null;
  log.warn(`Upload of ${bytes} bytes refused (${decision.reason}); used ${usedBytes} of ${quotaBytes ?? "no cap"}`);
  return STORAGE_CAP_MESSAGES[decision.reason];
}

let installed = false;
/** Hook the cap gate and usage deltas into storage.ts (idempotent). */
export function installStorageUsageTracking(): void {
  if (installed) return;
  installed = true;
  setUploadGate(gate);
  onLocalUsageChanged((delta) => {
    if (usage) usage.bytes = Math.max(0, usage.bytes + delta);
  });
}

installStorageUsageTracking();
