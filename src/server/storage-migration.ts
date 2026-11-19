/**
 * Copy every object from the old bucket (Backblaze B2) to the server disk,
 * key for key, so nothing else has to change. Server-only.
 *
 * - Resumable: files already on disk with the same size are skipped.
 * - Safe: each file is written to a temp name, renamed, then its size checked.
 * - B2's daily "cap exceeded" error pauses the run instead of failing every file.
 * - Progress lives in platform_settings.storageMigration so it survives restarts.
 * Nothing is deleted from the bucket.
 */
import { createLogger } from "@/lib/logger";
import {
  getLocalDiskSpace,
  hasS3Bucket,
  isLegacyS3ReadEnabled,
  isS3CapExceededMessage,
  listLegacyS3Objects,
  readLegacyS3Object,
  statLocalObject,
  writeLocalObject,
  type StorageObjectMeta,
} from "@/lib/storage";

const log = createLogger("storage-migration");

export const MIGRATION_SETTING_KEY = "storageMigration";
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const MAX_FAILED_LISTED = 200;
const DISK_HEADROOM = 1.1;

export type MigrationStateName = "idle" | "running" | "paused" | "blocked" | "done" | "failed";

export type MigrationState = {
  state: MigrationStateName;
  message: string | null;
  totalObjects: number;
  totalBytes: number;
  copied: number;
  skipped: number;
  bytesCopied: number;
  failedCount: number;
  failed: { key: string; error: string }[];
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

export type MigrationVerifyResult = {
  checkedAt: string;
  totalObjects: number;
  ok: number;
  missing: string[];
  missingCount: number;
  sizeMismatch: { key: string; source: number; local: number | null }[];
  sizeMismatchCount: number;
};

export type MigrationPreflight = {
  totalObjects: number;
  totalBytes: number;
  alreadyLocal: number;
  toCopyObjects: number;
  toCopyBytes: number;
  diskFreeBytes: number | null;
  enoughSpace: boolean;
};

export type MigrationDeps = {
  listSource: () => Promise<StorageObjectMeta[]>;
  readSource: (key: string) => Promise<{ data: Buffer; contentType: string }>;
  localSize: (key: string) => Promise<number | null>;
  writeLocal: (key: string, data: Buffer, contentType: string) => Promise<void>;
  diskFreeBytes: () => Promise<number | null>;
  loadState: () => Promise<MigrationState | null>;
  saveState: (state: MigrationState) => Promise<void>;
  now?: () => Date;
};

export function emptyMigrationState(): MigrationState {
  return {
    state: "idle",
    message: null,
    totalObjects: 0,
    totalBytes: 0,
    copied: 0,
    skipped: 0,
    bytesCopied: 0,
    failedCount: 0,
    failed: [],
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
  };
}

async function planCopy(deps: MigrationDeps) {
  const objects = await deps.listSource();
  const pending: StorageObjectMeta[] = [];
  let alreadyLocal = 0;
  for (const o of objects) {
    const size = await deps.localSize(o.key);
    if (size !== null && size === o.size) alreadyLocal++;
    else pending.push(o);
  }
  return { objects, pending, alreadyLocal };
}

export async function preflightMigration(deps: MigrationDeps): Promise<MigrationPreflight> {
  const { objects, pending, alreadyLocal } = await planCopy(deps);
  const toCopyBytes = pending.reduce((n, o) => n + o.size, 0);
  const diskFreeBytes = await deps.diskFreeBytes();
  return {
    totalObjects: objects.length,
    totalBytes: objects.reduce((n, o) => n + o.size, 0),
    alreadyLocal,
    toCopyObjects: pending.length,
    toCopyBytes,
    diskFreeBytes,
    enoughSpace: diskFreeBytes == null || diskFreeBytes >= toCopyBytes * DISK_HEADROOM,
  };
}

/** Copy everything not on disk yet. Resolves when the run ends (done / paused / blocked / failed). */
export async function runMigration(deps: MigrationDeps): Promise<MigrationState> {
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();
  const state: MigrationState = { ...emptyMigrationState(), state: "running", startedAt: now(), updatedAt: now() };
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 3000) return;
    lastSave = Date.now();
    state.updatedAt = now();
    await deps.saveState({ ...state, failed: state.failed.slice(0, MAX_FAILED_LISTED) }).catch((err) =>
      log.warn("Could not save migration progress", err),
    );
  };
  await save(true);

  let plan: Awaited<ReturnType<typeof planCopy>>;
  try {
    plan = await planCopy(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.state = isS3CapExceededMessage(message) ? "paused" : "failed";
    state.message = isS3CapExceededMessage(message)
      ? `The bucket refused the file list: daily cap reached. Raise the cap in Backblaze (Caps & Alerts) or wait for the reset, then resume. (${message})`
      : `Could not list the bucket: ${message}`;
    state.finishedAt = now();
    await save(true);
    return state;
  }

  state.totalObjects = plan.objects.length;
  state.totalBytes = plan.objects.reduce((n, o) => n + o.size, 0);
  state.skipped = plan.alreadyLocal;
  const toCopyBytes = plan.pending.reduce((n, o) => n + o.size, 0);
  const free = await deps.diskFreeBytes();
  if (free != null && free < toCopyBytes * DISK_HEADROOM) {
    state.state = "blocked";
    state.message = `Not enough free disk on the server: ${toCopyBytes} bytes to copy (+10% headroom), ${free} bytes free.`;
    state.finishedAt = now();
    await save(true);
    return state;
  }
  await save(true);

  let pausedReason: string | null = null;
  const queue = [...plan.pending];

  const copyOne = async (o: StorageObjectMeta) => {
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (pausedReason) return;
      try {
        const { data, contentType } = await deps.readSource(o.key);
        if (data.byteLength !== o.size) {
          throw new Error(`size mismatch: bucket says ${o.size} bytes, downloaded ${data.byteLength}`);
        }
        await deps.writeLocal(o.key, data, contentType);
        const written = await deps.localSize(o.key);
        if (written !== o.size) throw new Error(`size mismatch on disk: ${written ?? "missing"} vs ${o.size}`);
        state.copied++;
        state.bytesCopied += o.size;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (isS3CapExceededMessage(lastError)) {
          pausedReason = lastError;
          return;
        }
      }
    }
    state.failedCount++;
    if (state.failed.length < MAX_FAILED_LISTED) state.failed.push({ key: o.key, error: lastError.slice(0, 300) });
    log.warn(`Could not copy ${o.key}: ${lastError}`);
  };

  const worker = async () => {
    for (let o = queue.shift(); o && !pausedReason; o = queue.shift()) {
      await copyOne(o);
      await save();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  state.finishedAt = now();
  if (pausedReason) {
    state.state = "paused";
    state.message = `Paused: the bucket's daily download cap was reached. Raise it in Backblaze (Caps & Alerts) or wait for the reset, then resume — copied files are kept. (${pausedReason})`;
  } else if (state.failedCount > 0) {
    state.state = "failed";
    state.message = `${state.failedCount} file(s) could not be copied. Resume to retry them.`;
  } else {
    state.state = "done";
    state.message = `All ${state.totalObjects} files are on the server.`;
  }
  await save(true);
  log.info(
    `Migration ${state.state}: copied ${state.copied}, skipped ${state.skipped}, failed ${state.failedCount} of ${state.totalObjects}`,
  );
  return state;
}

/** Re-list the bucket and check every file is on disk with the same size. */
export async function verifyMigration(deps: MigrationDeps): Promise<MigrationVerifyResult> {
  const objects = await deps.listSource();
  const missing: string[] = [];
  const sizeMismatch: MigrationVerifyResult["sizeMismatch"] = [];
  let ok = 0;
  for (const o of objects) {
    const size = await deps.localSize(o.key);
    if (size === null) missing.push(o.key);
    else if (size !== o.size) sizeMismatch.push({ key: o.key, source: o.size, local: size });
    else ok++;
  }
  return {
    checkedAt: (deps.now ? deps.now() : new Date()).toISOString(),
    totalObjects: objects.length,
    ok,
    missing: missing.slice(0, 100),
    missingCount: missing.length,
    sizeMismatch: sizeMismatch.slice(0, 100),
    sizeMismatchCount: sizeMismatch.length,
  };
}

// ── Runtime wiring (real bucket, real disk, platform_settings) ──

async function db() {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin;
}

export function defaultMigrationDeps(): MigrationDeps {
  return {
    listSource: () => listLegacyS3Objects(""),
    readSource: (key) => readLegacyS3Object(key),
    localSize: async (key) => (await statLocalObject(key))?.size ?? null,
    writeLocal: (key, data, contentType) => writeLocalObject(key, data, contentType),
    diskFreeBytes: async () => (await getLocalDiskSpace())?.freeBytes ?? null,
    loadState: async () => {
      const { data } = await (await db())
        .from("platform_settings")
        .select("value")
        .eq("key", MIGRATION_SETTING_KEY)
        .maybeSingle();
      return (data?.value as MigrationState | null) ?? null;
    },
    saveState: async (state) => {
      const { error } = await (await db())
        .from("platform_settings")
        .upsert(
          { key: MIGRATION_SETTING_KEY, value: state, updatedAt: new Date().toISOString() },
          { onConflict: "key" },
        );
      if (error) throw new Error(error.message);
    },
  };
}

export const MIGRATION_VERIFY_SETTING_KEY = "storageMigrationVerify";

/** Run verify and keep the result for the panel. */
export async function verifyAndSaveMigration(): Promise<MigrationVerifyResult> {
  const result = await verifyMigration(defaultMigrationDeps());
  await (await db())
    .from("platform_settings")
    .upsert(
      { key: MIGRATION_VERIFY_SETTING_KEY, value: result, updatedAt: new Date().toISOString() },
      { onConflict: "key" },
    );
  return result;
}

export async function loadLastVerify(): Promise<MigrationVerifyResult | null> {
  const { data } = await (await db())
    .from("platform_settings")
    .select("value")
    .eq("key", MIGRATION_VERIFY_SETTING_KEY)
    .maybeSingle();
  return (data?.value as MigrationVerifyResult | null) ?? null;
}

// Process-wide: the startup hook and API routes may load separate copies of this module.
const shared = globalThis as unknown as {
  __storageMigrationRun?: Promise<MigrationState> | null;
  __storageMigrationAutoStarted?: boolean;
};

export function isMigrationRunning(): boolean {
  return !!shared.__storageMigrationRun;
}

/** Start (or resume) in the background. Returns false when a run is already going. */
export function startMigration(deps: MigrationDeps = defaultMigrationDeps()): boolean {
  if (!hasS3Bucket()) throw new Error("No Backblaze/S3 bucket is configured, so there is nothing to copy.");
  if (shared.__storageMigrationRun) return false;
  shared.__storageMigrationRun = runMigration(deps)
    .then(async (state) => {
      // Usage now includes the copied files.
      const { getLocalUsedBytes } = await import("@/lib/storage-usage");
      await getLocalUsedBytes({ fresh: true }).catch(() => 0);
      return state;
    })
    .catch((err) => {
      log.error("Migration crashed:", err);
      return { ...emptyMigrationState(), state: "failed" as const, message: String(err) };
    })
    .finally(() => {
      shared.__storageMigrationRun = null;
    });
  return true;
}

const AUTO_RESUME_INTERVAL_MS = 60 * 60 * 1000;

/**
 * While new files go to the server but old ones are still in the bucket,
 * retry the copy every hour (it pauses on the bucket's daily cap and skips
 * files already copied) until a run finishes with every file on disk.
 */
export function startMigrationAutoResume(): void {
  if (shared.__storageMigrationAutoStarted) return;
  shared.__storageMigrationAutoStarted = true;
  const tick = async () => {
    try {
      if (!isLegacyS3ReadEnabled() || isMigrationRunning()) return;
      const status = await getMigrationStatus();
      if (status.state === "done" || status.state === "blocked") return;
      log.info(`Auto-resuming bucket → server copy (last state: ${status.state})`);
      startMigration();
    } catch (err) {
      log.warn("Auto-resume check failed:", err);
    }
  };
  setTimeout(tick, 2 * 60 * 1000).unref?.();
  setInterval(tick, AUTO_RESUME_INTERVAL_MS).unref?.();
}

/** Saved progress; a "running" row with no run in this process means the server restarted mid-copy. */
export async function getMigrationStatus(deps: MigrationDeps = defaultMigrationDeps()): Promise<MigrationState & {
  inProcess: boolean;
}> {
  const saved = (await deps.loadState().catch(() => null)) ?? emptyMigrationState();
  if (saved.state === "running" && !shared.__storageMigrationRun) {
    return {
      ...saved,
      state: "paused",
      message: "Interrupted (the server restarted). Resume to continue — copied files are kept.",
      inProcess: false,
    };
  }
  return { ...saved, inProcess: !!shared.__storageMigrationRun };
}
