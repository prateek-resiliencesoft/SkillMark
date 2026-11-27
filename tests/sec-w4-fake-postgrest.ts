/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory PostgREST stand-in installed as globalThis.fetch, so code that uses
 * the real `supabaseAdmin` / `authDb` clients runs unmodified in tests.
 * Supports GET/HEAD/POST/PATCH/DELETE with eq/neq/is/in/lt/gte filters,
 * order, limit, single/maybeSingle, count=exact and per-table UNIQUE columns.
 * Tables are keyed "schema.table" ("public.sessions", "auth.users").
 */
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, any>;

// The installed @types/node predates module.registerHooks (Node >= 22.15).
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { createRequire, registerHooks } = nodeModule as typeof nodeModule & {
  registerHooks: (hooks: { resolve: ResolveHook }) => void;
};

// Router / delivery modules import "server-only", which throws outside the react-server condition.
const serverOnlyStub = pathToFileURL(join(createRequire(__filename).resolve("server-only"), "..", "empty.js")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: serverOnlyStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export const FAKE_POSTGREST_URL = "http://fake-postgrest.test";

export type FakePostgrest = {
  tables: Record<string, Row[]>;
  requests: { method: string; table: string; url: string }[];
  restore: () => void;
};

function parseValue(raw: string): any {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function same(a: any, b: any): boolean {
  if (a === null || a === undefined) return b === null;
  return String(a) === String(b);
}

function applyFilter(rows: Row[], col: string, expr: string): Row[] {
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  switch (op) {
    case "eq":
      return rows.filter((r) => same(r[col], parseValue(raw)));
    case "neq":
      return rows.filter((r) => !same(r[col], parseValue(raw)));
    case "is":
      return rows.filter((r) => (raw === "null" ? r[col] === null || r[col] === undefined : same(r[col], parseValue(raw))));
    case "in": {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      return rows.filter((r) => list.some((v) => same(r[col], v)));
    }
    case "ilike": {
      const re = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`, "i");
      return rows.filter((r) => re.test(String(r[col] ?? "")));
    }
    case "lt":
      return rows.filter((r) => r[col] < raw);
    case "gte":
      return rows.filter((r) => r[col] >= raw);
    default:
      return rows;
  }
}

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

export function installFakePostgrest(
  tables: Record<string, Row[]>,
  opts: { unique?: Record<string, string[]> } = {},
): FakePostgrest {
  const realFetch = globalThis.fetch;
  const requests: FakePostgrest["requests"] = [];

  const handler = async (input: any, init: any = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== FAKE_POSTGREST_URL) return realFetch(input, init);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const schema = headers.get("accept-profile") ?? headers.get("content-profile") ?? "public";
    const name = `${schema}.${url.pathname.replace(/^\//, "")}`;
    requests.push({ method, table: name, url: url.toString() });
    const table = (tables[name] ??= []);

    let rows = [...table];
    for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) rows = applyFilter(rows, k, v);
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1)));
    }
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));

    const prefer = headers.get("prefer") ?? "";
    const wantsObject = (headers.get("accept") ?? "").includes("vnd.pgrst.object+json");
    const select = url.searchParams.get("select");
    // Plain column lists only; embedded resources (`rel(...)`) return whole rows.
    const columns = select && select !== "*" && !select.includes("(") ? select.split(",").map((c) => c.trim().replace(/^"|"$/g, "")) : null;
    const project = (r: Row) => (columns ? Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])) : r);
    const respond = (raw: Row[] | null, status = 200, extra: Record<string, string> = {}) => {
      if (raw === null) return new Response(null, { status: 204, headers: extra });
      const data = raw.map(project);
      if (wantsObject) {
        if (data.length !== 1) {
          return Response.json(
            { code: "PGRST116", details: `The result contains ${data.length} rows`, message: "JSON object requested, multiple (or no) rows returned" },
            { status: 406 },
          );
        }
        return Response.json(data[0], { status, headers: extra });
      }
      return Response.json(data, { status, headers: extra });
    };
    const conflict = (rowsToCheck: Row[], skip: Row[]) => {
      for (const col of opts.unique?.[name] ?? []) {
        for (const r of rowsToCheck) {
          if (r[col] === undefined) continue;
          if (table.some((t) => !skip.includes(t) && t[col] === r[col])) {
            return Response.json(
              { code: "23505", message: `duplicate key value violates unique constraint "${name}_${col}_key"` },
              { status: 409 },
            );
          }
        }
      }
      return null;
    };

    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-range": `*/${rows.length}` } });
    }
    if (method === "GET") {
      const extra: Record<string, string> = prefer.includes("count=") ? { "content-range": `0-${rows.length}/${rows.length}` } : {};
      return respond(rows, 200, extra);
    }
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "POST") {
      const inserted = (Array.isArray(body) ? body : [body]).map((r: Row) => ({ id: r.id ?? crypto.randomUUID(), ...r }));
      const c = conflict(inserted, []);
      if (c) return c;
      table.push(...inserted);
      return prefer.includes("return=representation") ? respond(inserted, 201) : respond(null);
    }
    if (method === "PATCH") {
      const patched = rows.map((r) => ({ ...r, ...body }));
      const c = conflict(patched.length ? [body] : [], rows);
      if (c) return c;
      for (const r of rows) Object.assign(r, body);
      return prefer.includes("return=representation") ? respond(rows) : respond(null);
    }
    if (method === "DELETE") {
      tables[name] = table.filter((r) => !rows.includes(r));
      return prefer.includes("return=representation") ? respond(rows) : respond(null);
    }
    return new Response("unsupported", { status: 400 });
  };

  globalThis.fetch = handler as typeof fetch;
  return { tables, requests, restore: () => void (globalThis.fetch = realFetch) };
}
