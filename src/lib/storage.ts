/**
 * Local-disk file storage (replaces Supabase Storage).
 * Files live in STORAGE_DIR/<bucket>/<path> and are served by /api/files/<bucket>/<path>?token=…
 */
import { promises as fs } from "fs";
import path from "path";
import { SignJWT, jwtVerify } from "jose";

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");

function safeJoin(bucket: string, p: string) {
  const full = path.resolve(STORAGE_DIR, bucket, p);
  if (!full.startsWith(path.resolve(STORAGE_DIR, bucket) + path.sep)) throw new Error("Invalid storage path");
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
  const full = safeJoin(bucket, p);
  const data = await fs.readFile(full);
  let contentType = "application/octet-stream";
  try { contentType = (await fs.readFile(full + ".meta", "utf8")).trim() || contentType; } catch { /* none */ }
  return { data, contentType };
}

type Err = { message: string } | null;

/** Supabase-Storage-compatible subset: storage.from(bucket).upload/createSignedUrl/remove/download */
export const storage = {
  from(bucket: string) {
    return {
      async upload(p: string, body: Buffer | ArrayBuffer | Uint8Array, opts?: { contentType?: string; upsert?: boolean }): Promise<{ data: { path: string } | null; error: Err }> {
        try {
          const full = safeJoin(bucket, p);
          await fs.mkdir(path.dirname(full), { recursive: true });
          if (!opts?.upsert) {
            try { await fs.access(full); return { data: null, error: { message: "The resource already exists" } }; } catch { /* ok */ }
          }
          await fs.writeFile(full, Buffer.from(body as ArrayBuffer));
          if (opts?.contentType) await fs.writeFile(full + ".meta", opts.contentType);
          return { data: { path: p }, error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
      async createSignedUrl(p: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: Err }> {
        try {
          safeJoin(bucket, p);
          const token = await signFileToken(bucket, p, expiresIn);
          const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
          const rel = `/api/files/${encodeURIComponent(bucket)}/${p.split("/").map(encodeURIComponent).join("/")}?token=${token}`;
          return { data: { signedUrl: base + rel }, error: null };
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
          try { const f = safeJoin(bucket, p); await fs.rm(f, { force: true }); await fs.rm(f + ".meta", { force: true }); } catch { /* ignore */ }
        }
        return { data: null, error: null };
      },
    };
  },
};
