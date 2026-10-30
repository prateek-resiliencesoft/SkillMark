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

const key = () => new TextEncoder().encode(process.env.AUTH_SECRET || "");

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
    if (!res.ok) throw new Error(`S3 read failed: ${res.status}`);
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

async function s3Put(ok: string, body: Buffer, contentType?: string) {
  const res = await s3Client().fetch(objectUrl(ok), {
    method: "PUT",
    body: new Uint8Array(body),
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `S3 upload failed: ${res.status}`);
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
      if (!res.ok) throw new Error(`S3 list failed: ${res.status}`);
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

/** Delete all objects under a candidate/org prefix. Does not touch DB. */
export async function deletePrefix(prefix: string): Promise<number> {
  const keys = await listObjectKeys(prefix);
  for (const k of keys) {
    if (isObjectStorageEnabled()) {
      await s3Delete(k);
    } else {
      const full = path.resolve(STORAGE_DIR, k);
      if (!full.startsWith(STORAGE_DIR + path.sep)) continue;
      await fs.rm(full, { force: true });
      await fs.rm(full + ".meta", { force: true }).catch(() => {});
    }
  }
  return keys.length;
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
