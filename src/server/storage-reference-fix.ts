/**
 * Old rows sometimes saved a full, expiring file URL (a Backblaze signed URL
 * or an /api/files link) instead of the storage path. Readers re-sign paths,
 * so rewriting those URLs to bare paths makes them work from any store.
 * Server-only; run once after the bucket → server copy is verified.
 */
import { createLogger } from "@/lib/logger";
import { s3BucketBaseUrl } from "@/lib/storage";

const log = createLogger("storage-reference-fix");

export type RefFixContext = {
  /** e.g. https://s3.us-west-004.backblazeb2.com/skillmark — path-style bucket URL prefix. */
  bucketBaseUrl: string | null;
};

function decodeSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/**
 * Object key (as stored in the bucket / on disk) → the path the app passes to
 * storage.from(bucket): orgs/ keys are used as-is, older keys drop `<bucket>/`.
 */
function keyToStoredPath(segments: string[]): string | null {
  const orgsIdx = segments.indexOf("orgs");
  if (orgsIdx >= 0 && segments.length > orgsIdx + 1) return segments.slice(orgsIdx).join("/");
  if (segments.length < 2) return null;
  return segments.slice(1).join("/");
}

/** Bare stored path for a bucket or /api/files URL; null when the value is not one. */
export function storedUrlToPath(value: string, ctx: RefFixContext): string | null {
  const raw = value.trim();
  const isAbsolute = /^https?:\/\//i.test(raw);
  if (!isAbsolute && !raw.startsWith("/api/files/")) return null;

  let u: URL;
  try {
    u = new URL(raw, "http://local.invalid");
  } catch {
    return null;
  }
  const segments = decodeSegments(u.pathname);

  if (segments[0] === "api" && segments[1] === "files") {
    // /api/files/<bucket>/<objectKey>; very old links carried the path without `<bucket>/`.
    const rest = segments.slice(3);
    if (rest.includes("orgs") || rest[0] === segments[2]) return keyToStoredPath(rest);
    return rest.join("/") || null;
  }

  const host = u.hostname.toLowerCase();
  let base: URL | null = null;
  try {
    base = ctx.bucketBaseUrl ? new URL(ctx.bucketBaseUrl) : null;
  } catch {
    base = null;
  }
  const baseSegs = base ? decodeSegments(base.pathname) : [];
  const bucketName = baseSegs.at(-1) ?? null;

  if (base && host === base.hostname.toLowerCase() && bucketName && segments[0] === bucketName) {
    return keyToStoredPath(segments.slice(1));
  }
  if (!host.endsWith("backblazeb2.com")) return null;
  // B2 native download URL: /file/<bucket>/<key>
  if (segments[0] === "file") return keyToStoredPath(segments.slice(2));
  // Virtual-host style: <bucket>.s3.<region>.backblazeb2.com/<key>
  if (/^[^.]+\.s3\./.test(host)) return keyToStoredPath(segments);
  // Path style: s3.<region>.backblazeb2.com/<bucket>/<key>
  return keyToStoredPath(segments.slice(1));
}

/** Rewrite every bucket/api-files URL string inside a JSON value. */
export function rewriteStoredRefs<T>(value: T, ctx: RefFixContext): { value: T; changed: number } {
  let changed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const next = storedUrlToPath(v, ctx);
      if (next && next !== v) {
        changed++;
        return next;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const out = walk(value) as T;
  return { value: changed ? out : value, changed };
}

type TableSpec = { table: string; columns: string[] };

const TABLES: TableSpec[] = [
  { table: "sessions", columns: ["audioRecordingUrl", "screenshots", "antiCheatingLog", "audioRecordings"] },
  { table: "candidates", columns: ["profile"] },
  { table: "applications", columns: ["files"] },
  { table: "landing_media", columns: ["storageKey"] },
];

export type RefFixReport = {
  dryRun: boolean;
  scanned: Record<string, number>;
  rowsToFix: Record<string, number>;
  valuesToFix: number;
  samples: { table: string; id: string; column: string; before: string; after: string }[];
  errors: string[];
};

const PAGE = 500;

function firstChangedString(before: unknown, after: unknown): [string, string] | null {
  if (typeof before === "string" && typeof after === "string") return before !== after ? [before, after] : null;
  if (before && after && typeof before === "object" && typeof after === "object") {
    for (const k of Object.keys(before as object)) {
      const hit = firstChangedString((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k]);
      if (hit) return hit;
    }
  }
  return null;
}

/** Find (and unless dryRun, rewrite) stored file URLs in every media column. */
export async function fixStorageReferences(opts: { dryRun: boolean }): Promise<RefFixReport> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const ctx: RefFixContext = { bucketBaseUrl: s3BucketBaseUrl() };
  const report: RefFixReport = {
    dryRun: opts.dryRun,
    scanned: {},
    rowsToFix: {},
    valuesToFix: 0,
    samples: [],
    errors: [],
  };

  for (const spec of TABLES) {
    report.scanned[spec.table] = 0;
    report.rowsToFix[spec.table] = 0;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from(spec.table)
        .select(["id", ...spec.columns].join(", "))
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        report.errors.push(`${spec.table}: ${error.message}`);
        break;
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      report.scanned[spec.table] += rows.length;

      for (const row of rows) {
        const patch: Record<string, unknown> = {};
        for (const col of spec.columns) {
          const { value, changed } = rewriteStoredRefs(row[col], ctx);
          if (!changed) continue;
          patch[col] = value;
          report.valuesToFix += changed;
          const sample = firstChangedString(row[col], value);
          if (sample && report.samples.length < 25) {
            report.samples.push({ table: spec.table, id: String(row.id), column: col, before: sample[0], after: sample[1] });
          }
        }
        if (Object.keys(patch).length === 0) continue;
        report.rowsToFix[spec.table]++;
        if (opts.dryRun) continue;
        const { error: upErr } = await supabaseAdmin.from(spec.table).update(patch).eq("id", row.id as string);
        if (upErr) report.errors.push(`${spec.table} ${String(row.id)}: ${upErr.message}`);
      }
      if (rows.length < PAGE) break;
    }
  }

  log.info(
    `Reference fix (${opts.dryRun ? "dry run" : "applied"}): ${report.valuesToFix} values in ${JSON.stringify(report.rowsToFix)}`,
  );
  return report;
}
