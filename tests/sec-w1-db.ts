/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * W1 session-router test harness: an in-memory PostgREST stand-in (reads with
 * count/head, insert/update/delete, common filters, rpc) and a Next.js request
 * scope with a cookie jar so next/headers cookies() works inside procedures.
 * Embedded relations are not parsed: seed rows with the embedded object attached.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

process.env.AUTH_SECRET ??= "w1-test-auth-secret-0000000000000000000000";
process.env.POSTGREST_URL ??= "http://127.0.0.1:9";

type Row = Record<string, any>;
type ResolveHook = (specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { createRequire, registerHooks } = nodeModule as typeof nodeModule & {
  registerHooks: (hooks: { resolve: ResolveHook }) => void;
};
const req = createRequire(__filename);

// Routers import "server-only", which throws outside the react-server condition.
const serverOnlyStub = pathToFileURL(join(req.resolve("server-only"), "..", "empty.js")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: serverOnlyStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export type RpcHandler = (args: Row, tables: Record<string, Row[]>) => { data: any; error: any };

export function memDb(tables: Record<string, Row[]>, rpcs: Record<string, RpcHandler> = {}) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  const db = {
    tables,
    calls,
    rpc(name: string, args: Row) {
      const h = rpcs[name];
      // A real round trip yields; parallel callers interleave here.
      return new Promise((resolve) =>
        setImmediate(() => resolve(h ? h(args, tables) : { data: null, error: { code: "PGRST202", message: "missing" } })),
      );
    },
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let op = "select";
      let payload: any;
      let count = false;
      let head = false;
      let single: "one" | "maybe" | null = null;
      let lim: number | null = null;
      const rowsOf = () => (tables[table] ??= []);
      const exec = () => {
        calls.push({ table, op, payload });
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...r,
          }));
          rowsOf().push(...list);
          return { data: single ? list[0] : list, error: null };
        }
        const rows = rowsOf().filter((r) => preds.every((p) => p(r)));
        if (op === "update") for (const r of rows) Object.assign(r, payload);
        if (op === "delete") tables[table] = rowsOf().filter((r) => !rows.includes(r));
        const limited = lim === null ? rows : rows.slice(0, lim);
        if (count) return { data: head ? null : limited, count: rows.length, error: null };
        if (single) {
          const one = limited[0] ?? null;
          return { data: one, error: single === "one" && !one ? { code: "PGRST116", message: "not found" } : null };
        }
        return { data: limited, error: null };
      };
      const b: any = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => {
          if (o?.count) count = true;
          if (o?.head) head = true;
          return b;
        },
        insert: (rows: Row | Row[]) => ((op = "insert"), (payload = rows), b),
        update: (patch: Row) => ((op = "update"), (payload = patch), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: any) => (preds.push((r) => r[c] === v), b),
        neq: (c: string, v: any) => (preds.push((r) => r[c] !== v), b),
        is: (c: string, v: any) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), b),
        in: (c: string, v: any[]) => (preds.push((r) => v.includes(r[c])), b),
        gte: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] >= v), b),
        lte: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] <= v), b),
        lt: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] < v), b),
        not: () => b,
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        range: () => b,
        maybeSingle: () => ((single = "maybe"), b),
        single: () => ((single = "one"), b),
        then: (res: (v: any) => any, rej?: (e: any) => any) =>
          new Promise((r) => setImmediate(r)).then(exec).then(res, rej),
      };
      return b;
    },
  };
  return db;
}

/** Mirrors db/init/41-atomic-strike-append.sql (row lock = synchronous section). */
export const appendViolationRpc: RpcHandler = (a, tables) => {
  const s = (tables.sessions ?? []).find((r) => r.id === a.p_session_id);
  if (!s) return { data: null, error: null };
  const log: Row[] = Array.isArray(s.antiCheatingLog) ? s.antiCheatingLog : [];
  const strikesOf = (l: Row[]) => l.filter((v) => a.p_strike_types.includes(v.type)).length;
  if (s.status !== "IN_PROGRESS" || s.supersededAt || s.dataArchivedAt || log.length >= a.p_max_log) {
    return { data: { applied: false, status: s.status, strikes: strikesOf(log), disqualify: false, log }, error: null };
  }
  const next = [...log, a.p_violation];
  const strikes = strikesOf(next);
  const disqualify = a.p_strike_types.includes(a.p_violation.type) && strikes >= a.p_max_strikes;
  if (disqualify) {
    next.push({ type: "disqualified", timestamp: Date.now(), detail: `Disqualified after ${strikes} anti-cheating violations` });
    s.status = "DISQUALIFIED";
    s.completedAt = new Date().toISOString();
  }
  s.antiCheatingLog = next;
  return { data: { applied: true, status: s.status, strikes, disqualify, log: next }, error: null };
};

export function cookieJar() {
  const m = new Map<string, string>();
  const jar = {
    map: m,
    get: (name: string) => (m.has(name) ? { name, value: m.get(name)! } : undefined),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
    has: (name: string) => m.has(name),
    set: (name: string | { name: string; value: string }, value?: string) => {
      if (typeof name === "object") m.set(name.name, name.value);
      else m.set(name, value ?? "");
      return jar;
    },
    delete: (name: string) => (m.delete(name), jar),
  };
  return jar;
}

// Installed by Next's server runtime; request-scoped next/headers needs it.
(globalThis as any).AsyncLocalStorage ??= AsyncLocalStorage;
const { requestAsyncStorage } = req("next/dist/client/components/request-async-storage.external") as {
  requestAsyncStorage: { run: <T>(store: unknown, fn: () => T) => T };
};

/** Run fn as if inside a Next.js request from `ip` carrying `jar`'s cookies. */
export function inRequest<T>(jar: ReturnType<typeof cookieJar>, fn: () => Promise<T>, ip = "203.0.113.7"): Promise<T> {
  const headers = new Headers({ "x-real-ip": ip, "x-forwarded-for": ip });
  return requestAsyncStorage.run({ headers, cookies: jar, mutableCookies: jar, draftMode: {} }, fn);
}

export const ctxAs = (db: ReturnType<typeof memDb>, userId?: string) =>
  ({ user: userId ? { id: userId, email: `${userId}@example.com` } : null, supabase: db }) as never;
