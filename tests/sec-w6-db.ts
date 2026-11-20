/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory PostgREST stand-in for W6 router security tests. Supports reads
 * (with count/head), insert, update, upsert, delete and the common filters.
 * Embedded relations are not parsed: seed rows with the embedded object
 * (e.g. interviews[].project) already attached.
 */
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, any>;
export type Write = { table: string; op: "insert" | "update" | "upsert" | "delete"; rows: Row[]; payload?: any };

// The installed @types/node predates module.registerHooks (Node >= 22.15).
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { createRequire, registerHooks } = nodeModule as typeof nodeModule & {
  registerHooks: (hooks: { resolve: ResolveHook }) => void;
};

// Router modules import "server-only", which throws outside the react-server condition.
const serverOnlyStub = pathToFileURL(
  join(createRequire(__filename).resolve("server-only"), "..", "empty.js"),
).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: serverOnlyStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let seq = 0;

export function memDb(tables: Record<string, Row[]>) {
  const writes: Write[] = [];
  const db = {
    tables,
    writes,
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let op: "select" | Write["op"] = "select";
      let payload: any;
      let onConflict: string[] = [];
      let count = false;
      let head = false;
      let single: "one" | "maybe" | null = null;
      let lim: number | null = null;
      const rowsOf = () => (tables[table] ??= []);
      const matched = () => rowsOf().filter((r) => preds.every((p) => p(r)));
      const exec = () => {
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: `gen-${++seq}`, ...r }));
          rowsOf().push(...list);
          writes.push({ table, op, rows: list, payload });
          return { data: single ? list[0] : list, error: null };
        }
        if (op === "upsert") {
          const existing = rowsOf().find((r) => onConflict.every((k) => r[k] === payload[k]));
          if (existing) Object.assign(existing, payload);
          else rowsOf().push({ id: `gen-${++seq}`, ...payload });
          writes.push({ table, op, rows: [existing ?? payload], payload });
          return { data: null, error: null };
        }
        const rows = matched();
        if (op === "update") {
          for (const r of rows) Object.assign(r, payload);
          writes.push({ table, op, rows, payload });
        } else if (op === "delete") {
          tables[table] = rowsOf().filter((r) => !rows.includes(r));
          writes.push({ table, op, rows });
        }
        const limited = lim === null ? rows : rows.slice(0, lim);
        if (count) return { data: head ? null : limited, count: rows.length, error: null };
        if (single) {
          const one = limited[0] ?? null;
          return { data: one, error: single === "one" && !one ? { message: "not found", code: "PGRST116" } : null };
        }
        return { data: limited, error: null };
      };
      const b: any = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) count = true;
          if (opts?.head) head = true;
          return b;
        },
        insert: (rows: Row | Row[]) => ((op = "insert"), (payload = rows), b),
        update: (patch: Row) => ((op = "update"), (payload = patch), b),
        upsert: (row: Row, opts?: { onConflict?: string }) => {
          op = "upsert";
          payload = row;
          onConflict = (opts?.onConflict ?? "id").split(",");
          return b;
        },
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: any) => (preds.push((r) => r[c] === v), b),
        neq: (c: string, v: any) => (preds.push((r) => r[c] !== v), b),
        in: (c: string, v: any[]) => (preds.push((r) => v.includes(r[c])), b),
        gte: (c: string, v: any) => (preds.push((r) => r[c] >= v), b),
        lte: (c: string, v: any) => (preds.push((r) => r[c] <= v), b),
        lt: (c: string, v: any) => (preds.push((r) => r[c] < v), b),
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        range: () => b,
        maybeSingle: () => ((single = "maybe"), b),
        single: () => ((single = "one"), b),
        then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve(exec()).then(res, rej),
      };
      return b;
    },
  };
  return db;
}

export function ctxFor(db: ReturnType<typeof memDb>, userId: string) {
  return { user: { id: userId, email: `${userId}@example.com` }, supabase: db } as never;
}
