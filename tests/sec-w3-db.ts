/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory PostgREST stand-in for W3 storage/forms security tests.
 * Embedded relations are not parsed: seed rows with the embedded object
 * already attached (sessions[].interview.project). Dotted filter columns
 * ("interview.projectId") read nested values.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// media-review / candidate-data-deletion import "server-only", which throws outside react-server.
const emptyModule = path.join(mkdtempSync(path.join(os.tmpdir(), "w3-server-only-")), "empty.cjs");
writeFileSync(emptyModule, "");
(nodeModule as any).registerHooks?.({
  resolve(specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) {
    if (specifier === "server-only") return { url: pathToFileURL(emptyModule).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Row = Record<string, any>;

const get = (r: Row, col: string) => col.split(".").reduce<any>((v, k) => (v == null ? v : v[k]), r);

let seq = 0;

export function w3Db(tables: Record<string, Row[]>, opts: { failInsert?: string[] } = {}) {
  const deletes: { table: string; rows: Row[] }[] = [];
  return {
    tables,
    deletes,
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: any;
      let single: "one" | "maybe" | null = null;
      let lim: number | null = null;
      const rowsOf = () => (tables[table] ??= []);
      const exec = () => {
        if (op === "insert") {
          if (opts.failInsert?.includes(table)) return { data: null, error: { message: "insert failed" } };
          const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: `gen-${++seq}`, ...r }));
          rowsOf().push(...list);
          return { data: single ? list[0] : list, error: null };
        }
        const rows = rowsOf().filter((r) => preds.every((p) => p(r)));
        if (op === "update") {
          for (const r of rows) Object.assign(r, payload);
          return { data: null, error: null };
        }
        if (op === "delete") {
          tables[table] = rowsOf().filter((r) => !rows.includes(r));
          deletes.push({ table, rows });
          return { data: null, error: null };
        }
        const limited = lim === null ? rows : rows.slice(0, lim);
        if (single) {
          const one = limited[0] ?? null;
          return { data: one, error: single === "one" && !one ? { message: "not found" } : null };
        }
        return { data: limited, error: null, count: rows.length };
      };
      const b: any = {
        select: () => b,
        insert: (rows: Row | Row[]) => ((op = "insert"), (payload = rows), b),
        update: (patch: Row) => ((op = "update"), (payload = patch), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: any) => (preds.push((r) => get(r, c) === v), b),
        neq: (c: string, v: any) => (preds.push((r) => get(r, c) !== v), b),
        in: (c: string, v: any[]) => (preds.push((r) => v.includes(get(r, c))), b),
        is: (c: string, v: any) => (preds.push((r) => (get(r, c) ?? null) === v), b),
        lt: (c: string, v: any) => (preds.push((r) => get(r, c) < v), b),
        ilike: (c: string, v: string) => (preds.push((r) => String(get(r, c) ?? "").toLowerCase() === v.toLowerCase()), b),
        order: () => b,
        limit: (n: number) => ((lim = n), b),
        maybeSingle: () => ((single = "maybe"), b),
        single: () => ((single = "one"), b),
        then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve(exec()).then(res, rej),
      };
      return b;
    },
  };
}
