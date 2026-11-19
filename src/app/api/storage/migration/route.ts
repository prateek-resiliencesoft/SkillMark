import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { hasS3Bucket } from "@/lib/storage";
import {
  defaultMigrationDeps,
  getMigrationStatus,
  preflightMigration,
  startMigration,
  verifyAndSaveMigration,
} from "@/server/storage-migration";
import { fixStorageReferences } from "@/server/storage-reference-fix";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** CLI access from the server shell (scripts/migrate-b2-to-local.mjs). */
function hasInternalSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";
  const given = req.headers.get("x-migration-secret") || "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/storage/migration
 *   { action: "preflight" | "start" | "status" | "verify" | "fix-refs" (dry run) | "fix-refs-apply" }
 * Same operations as the super-admin Stored Media page, for running from the server.
 */
export async function POST(req: Request) {
  if (!hasInternalSecret(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === "status") return NextResponse.json(await getMigrationStatus());
  if (action === "fix-refs" || action === "fix-refs-apply") {
    return NextResponse.json(await fixStorageReferences({ dryRun: action === "fix-refs" }));
  }
  if (!hasS3Bucket()) {
    return NextResponse.json({ error: "No Backblaze/S3 bucket is configured." }, { status: 412 });
  }
  try {
    if (action === "preflight") return NextResponse.json(await preflightMigration(defaultMigrationDeps()));
    if (action === "start") return NextResponse.json({ started: startMigration() });
    if (action === "verify") return NextResponse.json(await verifyAndSaveMigration());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
  return NextResponse.json(
    { error: 'action must be "preflight", "start", "status", "verify", "fix-refs" or "fix-refs-apply"' },
    { status: 400 },
  );
}
