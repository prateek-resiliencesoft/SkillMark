/**
 * File storage: S3-compatible object store when configured (Backblaze B2 / R2 / MinIO),
 * else local STORAGE_DIR.
 *
 * API keeps Supabase-Storage shape: storage.from(bucket).upload|createSignedUrl|download|remove
 *
 * Keys prefer full hierarchy: orgs/.../kind/file. Legacy = `{bucket}/{path}`.
 *
 * Backblaze B2 (recommended, no card for free tier):
 *   S3_ENDPOINT=https://s3.<region>.backblazeb2.com
 *   S3_REGION=<region>   e.g. us-west-004
 *   S3_ACCESS_KEY_ID=<applicationKeyId>
 *   S3_SECRET_ACCESS_KEY=<applicationKey>
 *   S3_BUCKET=<bucketName>
 */
import { promises as fs } from "fs";
import path from "path";
import { SignJWT, jwtVerify } from "jose";
import { AwsClient } from "aws4fetch";

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");

const S3_ACCESS_KEY_ID =
  process.env.S3_ACCESS_KEY_ID?.trim() ||
  process.env.B2_KEY_ID?.trim() ||
  process.env.R2_ACCESS_KEY_ID?.trim() ||
  "";
const S3_SECRET_ACCESS_KEY =
  process.env.S3_SECRET_ACCESS_KEY?.trim() ||
  process.env.B2_APPLICATION_KEY?.trim() ||
  process.env.R2_SECRET_ACCESS_KEY?.trim() ||
  "";
const S3_BUCKET =
  process.env.S3_BUCKET?.trim() ||
  process.env.B2_BUCKET?.trim() ||
  process.env.R2_BUCKET?.trim() ||
  "";
const S3_REGION =
  process.env.S3_REGION?.trim() ||
  process.env.B2_REGION?.trim() ||
  "auto";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim() || "";
const S3_ENDPOINT = (
  process.env.S3_ENDPOINT?.trim() ||
  process.env.B2_ENDPOINT?.trim() ||
  process.env.R2_ENDPOINT?.trim() ||
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "")
).replace(/\/$/, "");

export function isObjectStorageEnabled(): boolean {
  return !!(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET && S3_ENDPOINT);
}

/** @deprecated use isObjectStorageEnabled */
export const isR2Enabled = isObjectStorageEnabled;

function s3Client(): AwsClient {
  return new AwsClient({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: S3_REGION || "auto",
  });
}

function objectUrl(ok: string): string {
  return `${S3_ENDPOINT}/${S3_BUCKET}/${ok.split("/").map(encodeURIComponent).join("/")}`;
}

function objectKey(bucket: string, p: string): string {
  if (p.startsWith("orgs/")) return p;
  return `${bucket}/${p}`;
}

function safeJoin(bucket: string, p: string) {
  const rel = objectKey(bucket, p);
  const full = path.resolve(STORAGE_DIR, rel);
  if (!full.startsWith(STORAGE_DIR + path.sep) && full !== STORAGE_DIR) {
    throw new Error("Invalid storage path");
  }
  return full;
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

export async function readFile(bucket: string, p: string) {
  if (isObjectStorageEnabled()) {
    const ok = objectKey(bucket, p);
    const res = await s3Client().fetch(objectUrl(ok));
    if (!res.ok) throw new Error(await s3FailureMessage("read", res));
    const data = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    return { data, contentType };
  }
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

/**
 * Readable message for a failed S3/B2 response, e.g. B2's
 * "AccessDenied — Cannot download file, download bandwidth or transaction (Class B) cap exceeded".
 */
async function s3FailureMessage(action: string, res: Response): Promise<string> {
  const t = (await res.text().catch(() => "")).slice(0, 600);
  const code = t.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const msg = t.match(/<Message>([^<]+)<\/Message>/)?.[1];
  const capHit = /cap exceeded/i.test(msg ?? "");
  const hint = capHit ? " Raise the cap under Backblaze → Caps & Alerts." : "";
  return code || msg
    ? `S3 ${action} failed (${res.status}): ${code ?? "error"}${msg ? ` — ${msg}` : ""}.${hint}`
    : `S3 ${action} failed: ${res.status}`;
}

async function s3Put(ok: string, body: Buffer, contentType?: string) {
  // B2 requires Content-Length. aws4fetch hashes/streams the body and undici then
  // sends chunked transfer (no Content-Length) → 411. Sign without reading body,
  // then PUT with an explicit length.
  const bytes = Buffer.from(body);
  const headers: Record<string, string> = {
    "content-type": contentType || "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
  };
  const signed = await s3Client().sign(objectUrl(ok), { method: "PUT", headers });
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: {
      ...Object.fromEntries(new Headers(signed.headers).entries()),
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 400);
    // Surface B2/S3 codes clearly (e.g. InvalidAccessKeyId)
    const code = t.match(/<Code>([^<]+)<\/Code>/)?.[1];
    const msg = t.match(/<Message>([^<]+)<\/Message>/)?.[1];
    throw new Error(
      code || msg
        ? `S3 upload failed (${res.status}): ${code ?? "error"}${msg ? ` — ${msg}` : ""}`
        : t || `S3 upload failed: ${res.status}`,
    );
  }
}

async function s3Head(ok: string): Promise<boolean> {
  const res = await s3Client().fetch(objectUrl(ok), { method: "HEAD" });
  return res.ok;
}

async function s3Delete(ok: string) {
  await s3Client().fetch(objectUrl(ok), { method: "DELETE" });
}

async function s3SignedGetUrl(ok: string, expiresIn: number): Promise<string> {
  const url = new URL(objectUrl(ok));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await s3Client().sign(new Request(url.toString(), { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Stored object metadata from S3/B2 or local storage */
export interface StorageObjectMeta {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

/** Storage configuration summary for ops & diagnostics */
export function getStorageConfigSummary() {
  const enabled = isObjectStorageEnabled();
  let provider = "Local Disk";
  if (enabled) {
    const ep = S3_ENDPOINT.toLowerCase();
    if (ep.includes("backblazeb2.com") || ep.includes("b2")) provider = "Backblaze B2";
    else if (ep.includes("r2.cloudflarestorage.com")) provider = "Cloudflare R2";
    else provider = "S3 Object Store";
  }
  return {
    enabled,
    provider,
    bucket: S3_BUCKET || (enabled ? "configured-bucket" : "local-storage"),
    endpoint: S3_ENDPOINT ? S3_ENDPOINT.replace(/\/$/, "") : "local://./storage",
    region: S3_REGION,
  };
}

/** List object keys under a prefix (S3 or local). */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const clean = prefix.replace(/^\/+/, "").replace(/\/?$/, "/");
  if (isObjectStorageEnabled()) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const url = new URL(`${S3_ENDPOINT}/${S3_BUCKET}`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", clean);
      if (token) url.searchParams.set("continuation-token", token);
      const res = await s3Client().fetch(url.toString());
      if (!res.ok) throw new Error(await s3FailureMessage("list", res));
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
      const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      token = truncated && next ? next[1] : undefined;
    } while (token);
    return keys;
  }

  const root = path.resolve(STORAGE_DIR, clean);
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.endsWith(".meta")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(`${clean}${r}`.replace(/\/{2,}/g, "/"));
    }
  }
  await walk(root, "");
  return out;
}

/** List objects with size and timestamp metadata (S3/B2 or local disk). */
export async function listObjectsWithMetadata(
  prefix: string = "",
  maxItems: number = 200,
): Promise<StorageObjectMeta[]> {
  const clean = prefix.replace(/^\/+/, "");
  if (isObjectStorageEnabled()) {
    const items: StorageObjectMeta[] = [];
    let token: string | undefined;
    {
      do {
        const url = new URL(`${S3_ENDPOINT}/${S3_BUCKET}`);
        url.searchParams.set("list-type", "2");
        if (clean) url.searchParams.set("prefix", clean);
        url.searchParams.set("max-keys", String(Math.min(maxItems, 500)));
        if (token) url.searchParams.set("continuation-token", token);
        const res = await s3Client().fetch(url.toString());
        // Throw (don't return a partial/empty list): an empty list made the admin
        // panel show "no media" and let deletes/measurements think nothing exists.
        if (!res.ok) throw new Error(await s3FailureMessage("list", res));
        const xml = await res.text();
        const contentMatches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
        for (const block of contentMatches) {
          const body = block[1];
          const keyMatch = body.match(/<Key>([^<]+)<\/Key>/);
          if (!keyMatch) continue;
          const key = keyMatch[1];
          const sizeMatch = body.match(/<Size>(\d+)<\/Size>/);
          const lastModMatch = body.match(/<LastModified>([^<]+)<\/LastModified>/);
          const etagMatch = body.match(/<ETag>([^<]+)<\/ETag>/);
          items.push({
            key,
            size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
            lastModified: lastModMatch ? lastModMatch[1] : undefined,
            etag: etagMatch ? etagMatch[1].replace(/"/g, "") : undefined,
          });
          if (items.length >= maxItems) break;
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
        const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
        token = truncated && next ? next[1] : undefined;
      } while (token && items.length < maxItems);
    }
    return items;
  }

  const root = clean ? path.resolve(STORAGE_DIR, clean) : STORAGE_DIR;
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
      if (e.name.endsWith(".meta")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(fullPath, r);
      } else {
        try {
          const st = await fs.stat(fullPath);
          const keyPath = clean
            ? `${clean.replace(/\/?$/, "/")}${r}`
            : r;
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
      if (isObjectStorageEnabled()) {
        await s3Delete(o.key);
      } else {
        const full = path.resolve(STORAGE_DIR, o.key);
        if (!full.startsWith(STORAGE_DIR + path.sep)) continue;
        await fs.rm(full, { force: true });
        await fs.rm(full + ".meta", { force: true }).catch(() => {});
      }
      bytes += o.size;
      objects += 1;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { objects, bytes };
}

/** Delete all objects under a candidate/org prefix. Does not touch DB. */
export async function deletePrefix(prefix: string): Promise<number> {
  return (await deletePrefixStats(prefix)).objects;
}

/** Whether an object exists at the key (used to avoid overwriting when merging folders). */
export async function storedObjectExists(key: string): Promise<boolean> {
  const clean = key.replace(/^\/+/, "");
  if (isObjectStorageEnabled()) return s3Head(clean);
  try {
    await fs.access(safeJoin("files", clean));
    return true;
  } catch {
    return false;
  }
}

/**
 * Capacity of the backing store.
 * - Local disk: real total/free from the filesystem.
 * - S3/B2/R2: the S3 API cannot report the account plan size, so the limit must be
 *   supplied: `configuredBytes` (saved by a super admin in the UI) or the
 *   STORAGE_QUOTA_GB / STORAGE_QUOTA_BYTES env vars. "unset" means nobody has told us.
 */
export async function getStorageCapacity(configuredBytes?: number | null): Promise<{
  source: "disk" | "quota" | "unset";
  limitFrom: "admin" | "env" | null;
  totalBytes: number | null;
  freeBytes: number | null;
}> {
  if (!isObjectStorageEnabled()) {
    try {
      await fs.mkdir(STORAGE_DIR, { recursive: true });
      const st = await fs.statfs(STORAGE_DIR);
      return {
        source: "disk",
        limitFrom: null,
        totalBytes: Number(st.blocks) * Number(st.bsize),
        freeBytes: Number(st.bavail) * Number(st.bsize),
      };
    } catch {
      return { source: "unset", limitFrom: null, totalBytes: null, freeBytes: null };
    }
  }
  if (configuredBytes && configuredBytes > 0) {
    return { source: "quota", limitFrom: "admin", totalBytes: configuredBytes, freeBytes: null };
  }
  const bytes = Number(process.env.STORAGE_QUOTA_BYTES);
  const gb = Number(process.env.STORAGE_QUOTA_GB);
  const quota =
    Number.isFinite(bytes) && bytes > 0 ? bytes : Number.isFinite(gb) && gb > 0 ? gb * 1024 ** 3 : null;
  return quota
    ? { source: "quota", limitFrom: "env", totalBytes: quota, freeBytes: null }
    : { source: "unset", limitFrom: null, totalBytes: null, freeBytes: null };
}

/** Copy an object from source key to destination key (Backblaze B2/S3 or local disk). */
export async function copyStoredObject(
  sourceKey: string,
  destKey: string,
): Promise<boolean> {
  const cleanSrc = sourceKey.replace(/^\/+/, "");
  const cleanDst = destKey.replace(/^\/+/, "");
  if (cleanSrc === cleanDst) return true;

  try {
    if (isObjectStorageEnabled()) {
      // First attempt native S3 x-amz-copy-source
      const destUrl = objectUrl(cleanDst);
      const headers: Record<string, string> = {
        "x-amz-copy-source": `/${S3_BUCKET}/${cleanSrc
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      };
      const signed = await s3Client().sign(destUrl, { method: "PUT", headers });
      const res = await fetch(signed.url, {
        method: "PUT",
        headers: Object.fromEntries(new Headers(signed.headers).entries()),
      });
      if (res.ok) return true;

      // Fallback: Read and put directly
      const { data, contentType } = await readFile("files", cleanSrc);
      await s3Put(cleanDst, data, contentType);
      return true;
    }

    // Local Disk Copy
    const srcFull = safeJoin("files", cleanSrc);
    const dstFull = safeJoin("files", cleanDst);
    await fs.mkdir(path.dirname(dstFull), { recursive: true });
    await fs.copyFile(srcFull, dstFull);
    try {
      await fs.copyFile(srcFull + ".meta", dstFull + ".meta");
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
    if (isObjectStorageEnabled()) {
      await s3Delete(cleanSrc);
    } else {
      const srcFull = safeJoin("files", cleanSrc);
      await fs.rm(srcFull, { force: true });
      await fs.rm(srcFull + ".meta", { force: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/** Supabase-Storage-compatible subset */
export const storage = {
  from(bucket: string) {
    return {
      async upload(
        p: string,
        body: Buffer | ArrayBuffer | Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ data: { path: string } | null; error: Err }> {
        try {
          const buf = Buffer.from(body as ArrayBuffer);
          const ok = objectKey(bucket, p);
          if (isObjectStorageEnabled()) {
            if (!opts?.upsert && (await s3Head(ok))) {
              return { data: null, error: { message: "The resource already exists" } };
            }
            await s3Put(ok, buf, opts?.contentType);
            return { data: { path: p.startsWith("orgs/") ? p : ok }, error: null };
          }
          const full = safeJoin(bucket, p);
          await fs.mkdir(path.dirname(full), { recursive: true });
          if (!opts?.upsert) {
            try {
              await fs.access(full);
              return { data: null, error: { message: "The resource already exists" } };
            } catch {
              /* ok */
            }
          }
          await fs.writeFile(full, buf);
          if (opts?.contentType) await fs.writeFile(full + ".meta", opts.contentType);
          return { data: { path: p.startsWith("orgs/") ? p : ok }, error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },

      async createSignedUrl(
        p: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: Err }> {
        try {
          const ok = objectKey(bucket, p);
          if (isObjectStorageEnabled()) {
            const signedUrl = await s3SignedGetUrl(ok, expiresIn);
            return { data: { signedUrl }, error: null };
          }
          safeJoin(bucket, p);
          const token = await signFileToken(bucket, p, expiresIn);
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
          const servePath = p.startsWith("orgs/") ? p : ok;
          const rel = `/api/files/${encodeURIComponent(bucket)}/${servePath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?token=${token}`;
          return { data: { signedUrl: base ? `${base}${rel}` : rel }, error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },

      async download(p: string): Promise<{ data: Blob | null; error: Err }> {
        try {
          const { data, contentType } = await readFile(bucket, p);
          return { data: new Blob([data], { type: contentType }), error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },

      async remove(paths: string[]): Promise<{ data: null; error: Err }> {
        for (const p of paths) {
          try {
            const ok = objectKey(bucket, p);
            if (isObjectStorageEnabled()) await s3Delete(ok);
            else {
              const f = safeJoin(bucket, p);
              await fs.rm(f, { force: true });
              await fs.rm(f + ".meta", { force: true }).catch(() => {});
            }
          } catch {
            /* ignore */
          }
        }
        return { data: null, error: null };
      },
    };
  },
};
