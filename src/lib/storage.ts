/**
 * File storage on the server disk (STORAGE_DIR).
 *
 * API keeps Supabase-Storage shape: storage.from(bucket).upload|createSignedUrl|download|remove
 *
 * Keys prefer full hierarchy: orgs/.../kind/file. Legacy = `{bucket}/{path}`.
 * Files live at STORAGE_DIR/<key> (+ `<key>.meta` holding the content type) and are
 * served by /api/files with a signed token.
 *
 * Media recorded before the move to disk is still in the old S3 bucket; while
 * S3_* credentials are set, reads fall back to it (see legacy-s3.ts). Writes
 * and deletes only ever touch the disk.
 */
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { SignJWT, jwtVerify } from "jose";
import { isLegacyS3Enabled, listLegacyS3Objects, readLegacyS3Object } from "@/lib/legacy-s3";
import { createLogger } from "@/lib/logger";

const storageLog = createLogger("storage");

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");

export function objectKey(bucket: string, p: string): string {
  if (p.startsWith("orgs/")) return p;
  return `${bucket}/${p}`;
}

/** Content-type sidecars and in-flight temp files share the object's directory. */
const RESERVED_NAME = /(\.meta|\.part-\d+-\d+)$/;

/**
 * Absolute disk path for an object key. Refuses dot segments, backslashes, NUL
 * and sidecar/temp names (listing hides those, so such objects would escape
 * quota accounting and prefix deletes), and anything outside STORAGE_DIR.
 */
export function localPathForKey(key: string): string {
  const clean = key.replace(/^\/+/, "");
  const segments = clean.split("/");
  if (
    !clean ||
    /[\\\0]/.test(clean) ||
    segments.some((s) => s === "." || s === "..") ||
    RESERVED_NAME.test(segments[segments.length - 1])
  ) {
    throw new Error("Invalid storage path");
  }
  const full = path.resolve(STORAGE_DIR, clean);
  if (!full.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error("Invalid storage path");
  }
  return full;
}

function safeJoin(bucket: string, p: string) {
  return localPathForKey(objectKey(bucket, p));
}


const key = () =>
  new TextEncoder().encode(
    process.env.AUTH_SECRET || "resiliencesoft-default-storage-auth-secret-key-32",
  );

export async function signFileToken(bucket: string, p: string, expiresInSec: number) {
  return new SignJWT({ b: bucket, p })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSec)
    .sign(key());
}

export async function verifyFileToken(token: string, bucket: string, p: string) {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.b === bucket && payload.p === p;
  } catch {
    return false;
  }
}

/** Size + content type of a file on the server disk, or null when it isn't there. */
export async function statLocalObject(
  objKey: string,
): Promise<{ fullPath: string; size: number; contentType: string } | null> {
  let fullPath: string;
  try {
    fullPath = localPathForKey(objKey);
  } catch {
    return null;
  }
  try {
    const st = await fs.stat(fullPath);
    if (!st.isFile()) return null;
    let contentType = "application/octet-stream";
    try {
      contentType = (await fs.readFile(fullPath + ".meta", "utf8")).trim() || contentType;
    } catch {
      /* none */
    }
    return { fullPath, size: st.size, contentType };
  } catch {
    return null;
  }
}

/** Stream (part of) a local file. */
export function openLocalObjectStream(fullPath: string, range?: { start: number; end: number }) {
  return createReadStream(fullPath, range);
}

/** Write a file to the server disk atomically (temp file + rename) with its content type. */
export async function writeLocalObject(objKey: string, data: Buffer, contentType?: string | null): Promise<void> {
  const full = localPathForKey(objKey);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.part-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  if (contentType) await fs.writeFile(full + ".meta", contentType);
}

async function removeLocalObject(objKey: string): Promise<void> {
  const full = localPathForKey(objKey);
  await fs.rm(full, { force: true });
  await fs.rm(full + ".meta", { force: true }).catch(() => {});
}

export async function readFile(bucket: string, p: string) {
  const full = safeJoin(bucket, p);
  const data = await fs.readFile(full);
  let contentType = "application/octet-stream";
  try {
    contentType = (await fs.readFile(full + ".meta", "utf8")).trim() || contentType;
  } catch {
    /* none */
  }
  return { data, contentType };
}

type Err = { message: string } | null;

/** Stored object metadata */
export interface StorageObjectMeta {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

/** Storage configuration summary for ops & diagnostics */
export function getStorageConfigSummary() {
  return {
    provider: "VPS Disk",
    bucket: "local-storage",
    endpoint: `local://${STORAGE_DIR}`,
  };
}

async function listLocalObjects(prefix: string, maxItems: number): Promise<StorageObjectMeta[]> {
  const clean = prefix.replace(/^\/+/, "");
  const root = clean ? path.resolve(STORAGE_DIR, clean) : STORAGE_DIR;
  if (root !== STORAGE_DIR && !root.startsWith(STORAGE_DIR + path.sep)) return [];
  const items: StorageObjectMeta[] = [];
  async function walk(dir: string, rel: string) {
    if (items.length >= maxItems) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (items.length >= maxItems) break;
      // Content-type sidecars and in-flight temp files are not objects.
      if (e.name.endsWith(".meta") || /\.part-\d+-\d+$/.test(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(fullPath, r);
      } else {
        try {
          const st = await fs.stat(fullPath);
          const keyPath = clean ? `${clean.replace(/\/?$/, "/")}${r}` : r;
          items.push({
            key: keyPath.replace(/\/{2,}/g, "/"),
            size: st.size,
            lastModified: st.mtime.toISOString(),
          });
        } catch {
          // ignore unreadable
        }
      }
    }
  }
  await walk(root, "");
  return items;
}

/** List object keys under a prefix (disk, plus the legacy bucket when configured). */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const clean = prefix.replace(/^\/+/, "").replace(/\/?$/, "/");
  const local = (await listLocalObjects(clean, Number.MAX_SAFE_INTEGER)).map((o) => o.key);
  if (!isLegacyS3Enabled()) return local;
  try {
    const legacy = (await listLegacyS3Objects(clean)).map((o) => o.key);
    return Array.from(new Set([...local, ...legacy]));
  } catch (err) {
    storageLog.warn(`Legacy bucket list skipped for ${clean}: ${err instanceof Error ? err.message : err}`);
    return local;
  }
}

/** List objects with size and timestamp metadata. */
export async function listObjectsWithMetadata(
  prefix: string = "",
  maxItems: number = 200,
): Promise<StorageObjectMeta[]> {
  return listLocalObjects(prefix.replace(/^\/+/, ""), maxItems);
}

/** Every object under a prefix with sizes (no item cap). */
export async function listAllObjects(prefix: string = ""): Promise<StorageObjectMeta[]> {
  const clean = prefix ? prefix.replace(/^\/+/, "").replace(/\/?$/, "/") : "";
  return listObjectsWithMetadata(clean, Number.MAX_SAFE_INTEGER);
}

/** Total bytes + object count under a prefix, without deleting anything. */
export async function measurePrefix(prefix: string): Promise<{ objects: number; bytes: number }> {
  const objs = await listAllObjects(prefix);
  return { objects: objs.length, bytes: objs.reduce((n, o) => n + o.size, 0) };
}

/** Delete all objects under a candidate/org prefix and report what was freed. Does not touch DB. */
export async function deletePrefixStats(
  prefix: string,
): Promise<{ objects: number; bytes: number }> {
  const objs = await listAllObjects(prefix);
  let bytes = 0;
  let objects = 0;
  const queue = [...objs];
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      try {
        await removeLocalObject(o.key);
      } catch {
        continue;
      }
      bytes += o.size;
      objects += 1;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  notifyLocalUsageChanged(-bytes);
  const clean = prefix.replace(/^\/+/, "");
  if (clean) await sweepOrphanSidecars(path.resolve(STORAGE_DIR, clean));
  return { objects, bytes };
}

const STALE_TEMP_MS = 15 * 60 * 1000;

/** Remove `.meta` files whose object is gone and abandoned temp files (listing never shows either). */
async function sweepOrphanSidecars(dir: string): Promise<void> {
  if (!dir.startsWith(STORAGE_DIR + path.sep)) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await sweepOrphanSidecars(full);
      continue;
    }
    try {
      if (e.name.endsWith(".meta")) {
        const base = await fs.stat(full.slice(0, -".meta".length)).catch(() => null);
        if (!base) await fs.rm(full, { force: true });
      } else if (/\.part-\d+-\d+$/.test(e.name)) {
        const st = await fs.stat(full);
        if (Date.now() - st.mtimeMs > STALE_TEMP_MS) await fs.rm(full, { force: true });
      }
    } catch {
      /* best effort */
    }
  }
}

/** Delete all objects under a candidate/org prefix. Does not touch DB. */
export async function deletePrefix(prefix: string): Promise<number> {
  return (await deletePrefixStats(prefix)).objects;
}

/** Whether an object exists at the key (used to avoid overwriting when merging folders). */
export async function storedObjectExists(objKey: string): Promise<boolean> {
  return !!(await statLocalObject(objKey.replace(/^\/+/, "")));
}

/**
 * Capacity of the server disk: real total/free from the filesystem, narrowed to the
 * cap (`configuredBytes` saved by a super admin, else STORAGE_QUOTA_GB / STORAGE_QUOTA_BYTES)
 * when one is set. `usedBytes` lets free space reflect the cap: min(cap − used, disk free).
 */
export async function getStorageCapacity(
  configuredBytes?: number | null,
  usedBytes?: number | null,
): Promise<{
  source: "disk" | "quota" | "unset";
  limitFrom: "admin" | "env" | null;
  totalBytes: number | null;
  freeBytes: number | null;
  diskTotalBytes?: number | null;
  diskFreeBytes?: number | null;
}> {
  const bytes = Number(process.env.STORAGE_QUOTA_BYTES);
  const gb = Number(process.env.STORAGE_QUOTA_GB);
  const envQuota =
    Number.isFinite(bytes) && bytes > 0 ? bytes : Number.isFinite(gb) && gb > 0 ? gb * 1024 ** 3 : null;
  const adminQuota = configuredBytes && configuredBytes > 0 ? configuredBytes : null;
  const quota = adminQuota ?? envQuota;
  const limitFrom = adminQuota ? ("admin" as const) : envQuota ? ("env" as const) : null;

  const disk = await getLocalDiskSpace();
  if (!disk) {
    return quota
      ? { source: "quota", limitFrom, totalBytes: quota, freeBytes: null }
      : { source: "unset", limitFrom: null, totalBytes: null, freeBytes: null };
  }
  if (!quota) {
    return {
      source: "disk",
      limitFrom: null,
      totalBytes: disk.totalBytes,
      freeBytes: disk.freeBytes,
      diskTotalBytes: disk.totalBytes,
      diskFreeBytes: disk.freeBytes,
    };
  }
  const capFree = usedBytes != null ? Math.max(0, quota - usedBytes) : quota;
  return {
    source: "quota",
    limitFrom,
    totalBytes: Math.min(quota, disk.totalBytes),
    freeBytes: Math.min(capFree, disk.freeBytes),
    diskTotalBytes: disk.totalBytes,
    diskFreeBytes: disk.freeBytes,
  };
}

/** Physical size / free space of the disk holding STORAGE_DIR. */
export async function getLocalDiskSpace(): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const st = await fs.statfs(STORAGE_DIR);
    return {
      totalBytes: Number(st.blocks) * Number(st.bsize),
      freeBytes: Number(st.bavail) * Number(st.bsize),
    };
  } catch {
    return null;
  }
}

/** Copy an object from source key to destination key. */
export async function copyStoredObject(
  sourceKey: string,
  destKey: string,
): Promise<boolean> {
  const cleanSrc = sourceKey.replace(/^\/+/, "");
  const cleanDst = destKey.replace(/^\/+/, "");
  if (cleanSrc === cleanDst) return true;

  try {
    const src = await statLocalObject(cleanSrc);
    if (!src) return false;
    const dstFull = localPathForKey(cleanDst);
    await fs.mkdir(path.dirname(dstFull), { recursive: true });
    await fs.copyFile(src.fullPath, dstFull);
    try {
      await fs.copyFile(src.fullPath + ".meta", dstFull + ".meta");
    } catch {
      // metadata file optional
    }
    return true;
  } catch {
    return false;
  }
}

/** Move an object (copy to destination, then delete original source). */
export async function moveStoredObject(
  sourceKey: string,
  destKey: string,
): Promise<boolean> {
  const cleanSrc = sourceKey.replace(/^\/+/, "");
  const cleanDst = destKey.replace(/^\/+/, "");
  if (cleanSrc === cleanDst) return true;

  const copied = await copyStoredObject(cleanSrc, cleanDst);
  if (!copied) return false;

  try {
    await removeLocalObject(cleanSrc);
    return true;
  } catch {
    return false;
  }
}

// ── Local usage hook (storage-usage.ts subscribes; keeps this file free of DB imports) ──
type UsageListener = (deltaBytes: number) => void;
let usageListener: UsageListener | null = null;
export function onLocalUsageChanged(fn: UsageListener | null): void {
  usageListener = fn;
}
function notifyLocalUsageChanged(delta: number): void {
  if (delta) usageListener?.(delta);
}

let inFlightUploadBytes = 0;

/** Upload gate installed by storage-usage.ts. Returns an error message to refuse the upload. */
type UploadGate = (bytes: number, opts: { liveSession: boolean }) => Promise<string | null>;
let uploadGate: UploadGate | null = null;
export function setUploadGate(fn: UploadGate | null): void {
  uploadGate = fn;
}

/** The super-admin storage cap. STORAGE_CAP_GATE=off disables it (tests). */
async function loadUploadGate(): Promise<UploadGate | null> {
  if (uploadGate || process.env.STORAGE_CAP_GATE === "off") return uploadGate;
  await import("@/lib/storage-usage");
  return uploadGate;
}

/** Supabase-Storage-compatible subset */
export const storage = {
  from(bucket: string) {
    return {
      async upload(
        p: string,
        body: Buffer | ArrayBuffer | Uint8Array,
        opts?: {
          contentType?: string;
          upsert?: boolean;
          /** Media for an interview that is running now: allowed past the cap (disk floor still applies). */
          liveSession?: boolean;
        },
      ): Promise<{ data: { path: string } | null; error: Err }> {
        const buf = Buffer.from(body as ArrayBuffer);
        // Reserve before the first await so concurrent uploads see each other's bytes.
        const othersInFlight = inFlightUploadBytes;
        inFlightUploadBytes += buf.byteLength;
        try {
          const ok = objectKey(bucket, p);
          localPathForKey(ok);
          const gate = await loadUploadGate();
          if (gate) {
            const refused = await gate(buf.byteLength + othersInFlight, { liveSession: !!opts?.liveSession });
            if (refused) return { data: null, error: { message: refused } };
          }
          const existing = await statLocalObject(ok);
          if (!opts?.upsert && existing) {
            return { data: null, error: { message: "The resource already exists" } };
          }
          await writeLocalObject(ok, buf, opts?.contentType);
          notifyLocalUsageChanged(buf.byteLength - (existing?.size ?? 0));
          return { data: { path: p.startsWith("orgs/") ? p : ok }, error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        } finally {
          inFlightUploadBytes -= buf.byteLength;
        }
      },

      async createSignedUrl(
        p: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: Err }> {
        try {
          const ok = objectKey(bucket, p);
          localPathForKey(ok);
          return { data: { signedUrl: await localFileUrl(bucket, ok, expiresIn) }, error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },

      async download(p: string): Promise<{ data: Blob | null; error: Err }> {
        try {
          const { data, contentType } = await readFile(bucket, p);
          return { data: new Blob([new Uint8Array(data)], { type: contentType }), error: null };
        } catch (e) {
          // Not on disk: older media may still be in the legacy bucket.
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT" && isLegacyS3Enabled()) {
            try {
              const legacy = await readLegacyS3Object(objectKey(bucket, p));
              if (legacy) {
                return { data: new Blob([new Uint8Array(legacy.data)], { type: legacy.contentType }), error: null };
              }
            } catch (le) {
              return { data: null, error: { message: le instanceof Error ? le.message : String(le) } };
            }
          }
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },

      async remove(paths: string[]): Promise<{ data: null; error: Err }> {
        for (const p of paths) {
          try {
            const ok = objectKey(bucket, p);
            const st = await statLocalObject(ok);
            await removeLocalObject(ok);
            if (st) notifyLocalUsageChanged(-st.size);
          } catch {
            /* ignore */
          }
        }
        return { data: null, error: null };
      },
    };
  },
};

/**
 * `/api/files/{bucket}/{objectKey}?token=…` — the token is bound to the object
 * key, which is also the path on disk, so the route never re-derives it.
 */
async function localFileUrl(bucket: string, objKey: string, expiresIn: number): Promise<string> {
  const token = await signFileToken(bucket, objKey, expiresIn);
  let base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) {
    try {
      const { headers } = await import("next/headers");
      const h = headers();
      const host = h.get("x-forwarded-host") ?? h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "https";
      if (host) base = `${proto}://${host}`;
    } catch {
      /* outside request */
    }
  }
  const rel = `/api/files/${encodeURIComponent(bucket)}/${objKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?token=${token}`;
  return base ? `${base}${rel}` : rel;
}
