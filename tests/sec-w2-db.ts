/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory PostgREST + storage stand-in for the W2 session route tests.
 * Installs itself on `supabaseAdmin` (a plain object), so route handlers can
 * be called directly. Embedded relations are not parsed: seed rows with the
 * embedded object (e.g. sessions[].interview) already attached.
 */
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sessionCapabilityCookieName, signSessionCapability } from "@/lib/session-capability";

process.env.AUTH_SECRET ||= "test-auth-secret-for-w2-session-routes-000000";

// Route modules import "server-only", which throws outside the react-server condition.
const serverOnlyStub = pathToFileURL(
  join(nodeModule.createRequire(__filename).resolve("server-only"), "..", "empty.js"),
).href;
(nodeModule as any).registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) {
    if (specifier === "server-only") return { url: serverOnlyStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Row = Record<string, any>;
export type Write = { table: string; op: string; rows: Row[]; payload?: any };

export function memDb(tables: Record<string, Row[]>) {
  const writes: Write[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let payload: any;
    let single: null | "one" | "maybe" = null;
    let returning = false;
    let limitN: number | undefined;
    const run = () => {
      const rows = (tables[table] ??= []);
      if (op === "insert" || op === "upsert") {
        const arr = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ ...r }));
        rows.push(...arr);
        writes.push({ table, op, rows: arr, payload });
        return { data: returning ? arr : null, error: null };
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        matched.forEach((r) => Object.assign(r, payload));
        writes.push({ table, op, rows: matched, payload });
        return { data: returning ? matched : null, error: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !matched.includes(r));
        writes.push({ table, op, rows: matched });
        return { data: null, error: null };
      }
      const out = limitN === undefined ? matched : matched.slice(0, limitN);
      if (single) {
        return { data: out[0] ?? null, error: single === "one" && !out[0] ? { message: "not found" } : null };
      }
      return { data: out, error: null };
    };
    const b: any = {
      select: () => {
        if (op !== "select") returning = true;
        return b;
      },
      update: (p: Row) => ((op = "update"), (payload = p), b),
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
      upsert: (p: Row | Row[]) => ((op = "upsert"), (payload = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), b),
      contains: (c: string, v: any[]) => (filters.push((r) => Array.isArray(r[c]) && v.every((x) => r[c].includes(x))), b),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), b),
      lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), b),
      lt: (c: string, v: any) => (filters.push((r) => r[c] < v), b),
      gt: (c: string, v: any) => (filters.push((r) => r[c] > v), b),
      order: () => b,
      limit: (n: number) => ((limitN = n), b),
      maybeSingle: () => ((single = "maybe"), b),
      single: () => ((single = "one"), b),
      then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from, writes, tables };
}

export type StoredObject = { bucket: string; key: string; bytes: number; contentType?: string; upsert?: boolean };

export function memStorage() {
  const objects = new Map<string, StoredObject>();
  const uploads: StoredObject[] = [];
  return {
    objects,
    uploads,
    from(bucket: string) {
      return {
        async upload(key: string, buf: Buffer, opts: { contentType?: string; upsert?: boolean } = {}) {
          const id = `${bucket}/${key}`;
          if (!opts.upsert && objects.has(id)) return { data: null, error: { message: "The resource already exists" } };
          const o = { bucket, key, bytes: buf.byteLength, contentType: opts.contentType, upsert: opts.upsert };
          objects.set(id, o);
          uploads.push(o);
          return { data: { path: key }, error: null };
        },
        async createSignedUrl(key: string) {
          return { data: { signedUrl: `/api/files/${bucket}/${key}?token=t` }, error: null };
        },
        async remove() {
          return { data: null, error: null };
        },
        async download() {
          return { data: null, error: { message: "not found" } };
        },
      };
    },
  };
}

/** Point supabaseAdmin at fresh in-memory tables (and storage). */
export function installDb(tables: Record<string, Row[]>) {
  const db = memDb(tables);
  const storage = memStorage();
  (supabaseAdmin as any).from = db.from;
  (supabaseAdmin as any).storage = storage;
  return { ...db, storage };
}

export function capCookie(sessionId: string): string {
  return `${sessionCapabilityCookieName(sessionId)}=${signSessionCapability(sessionId)}`;
}

let ipSeq = 0;
/** Same-origin JSON POST, each from a fresh client IP so in-memory rate limits never bleed between tests. */
export function jsonPost(path: string, body: unknown, opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let uuidSeq = 0;
export function uuid(): string {
  const n = (++uuidSeq).toString(16).padStart(12, "0");
  return `3f6c1d2e-8a4b-4c5d-9e0f-${n}`;
}

export const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
