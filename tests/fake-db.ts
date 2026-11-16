/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tiny in-memory stand-in for the PostgREST query builder, enough for the
 * public API service tests (select/eq/in/gte/lte/lt/ilike/order/limit).
 */
type Row = Record<string, any>;

export function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; filters: string[] }[] = [];
  return {
    calls,
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const filters: string[] = [];
      calls.push({ table, filters });
      let single: "one" | "maybe" | null = null;
      const b: any = {
        select: () => b,
        eq: (c: string, v: any) => ((rows = rows.filter((r) => r[c] === v)), filters.push(`eq:${c}`), b),
        in: (c: string, v: any[]) => ((rows = rows.filter((r) => v.includes(r[c]))), filters.push(`in:${c}`), b),
        gte: (c: string, v: any) => ((rows = rows.filter((r) => r[c] >= v)), b),
        lte: (c: string, v: any) => ((rows = rows.filter((r) => r[c] <= v)), b),
        lt: (c: string, v: any) => ((rows = rows.filter((r) => r[c] < v)), b),
        ilike: (c: string, v: string) => {
          const want = v.replace(/\\(.)/g, "$1").toLowerCase();
          rows = rows.filter((r) => String(r[c] ?? "").toLowerCase() === want);
          return b;
        },
        order: (c: string, o?: { ascending?: boolean }) => {
          const asc = o?.ascending !== false;
          rows.sort((x, y) => (x[c] === y[c] ? 0 : (x[c] > y[c] ? 1 : -1) * (asc ? 1 : -1)));
          return b;
        },
        limit: (n: number) => ((rows = rows.slice(0, n)), b),
        maybeSingle: () => ((single = "maybe"), b),
        single: () => ((single = "one"), b),
        then: (res: (v: any) => any, rej?: (e: any) => any) => {
          const data = single ? (rows[0] ?? null) : rows;
          const error = single === "one" && !rows[0] ? { message: "not found" } : null;
          return Promise.resolve({ data, error }).then(res, rej);
        },
      };
      return b;
    },
  };
}
