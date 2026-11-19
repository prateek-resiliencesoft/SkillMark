#!/usr/bin/env node
/**
 * Copy all media from the Backblaze B2 bucket to the server disk via the
 * running app (POST /api/storage/migration). Same job as the "Move media to
 * this server" card on the super-admin Stored Media page; resumable.
 *
 * Run inside the app container (it already has CRON_SECRET / AUTH_SECRET):
 *   docker exec -i skillmark-app-1 node --input-type=module - <action> < scripts/migrate-b2-to-local.mjs
 * or with a checkout + env:
 *   node scripts/migrate-b2-to-local.mjs <action>
 *
 * Actions:
 *   preflight  how many files / bytes, how much is already copied, free disk
 *   start      start or resume the copy and follow progress until it stops
 *   status     show saved progress
 *   verify     re-list the bucket and check every file is on disk with the same size
 *   fix-refs        dry run: count saved full file URLs that should be bare paths
 *   fix-refs-apply  rewrite them
 *
 * Optional: APP_URL (default http://127.0.0.1:$PORT, PORT default 3000).
 */
const ACTIONS = ["preflight", "start", "status", "verify", "fix-refs", "fix-refs-apply"];
const action = process.argv.slice(1).find((a) => ACTIONS.includes(a)) || "status";
const secret = process.env.CRON_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET or AUTH_SECRET must be set (run this inside the app container).");
  process.exit(2);
}
const base = (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");

const gb = (n) => (n == null ? "?" : `${(n / 1024 ** 3).toFixed(2)} GB`);

async function call(act) {
  const res = await fetch(`${base}/api/storage/migration`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-migration-secret": secret },
    body: JSON.stringify({ action: act }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${body.error || "unknown error"}`);
    process.exit(1);
  }
  return body;
}

function printStatus(s) {
  const done = s.copied + s.skipped;
  const pct = s.totalObjects ? ((done / s.totalObjects) * 100).toFixed(1) : "0";
  console.log(
    `[${s.state}] ${done}/${s.totalObjects} files (${pct}%) • copied ${s.copied} (${gb(s.bytesCopied)}) • already there ${s.skipped} • failed ${s.failedCount}`,
  );
  if (s.message) console.log(`  ${s.message}`);
}

try {
  if (action === "preflight") {
    const p = await call("preflight");
    console.log(`Bucket files     : ${p.totalObjects} (${gb(p.totalBytes)})`);
    console.log(`Already on disk  : ${p.alreadyLocal}`);
    console.log(`To copy          : ${p.toCopyObjects} (${gb(p.toCopyBytes)})`);
    console.log(`Free disk        : ${gb(p.diskFreeBytes)} → ${p.enoughSpace ? "enough" : "NOT enough (need +10% headroom)"}`);
  } else if (action === "verify") {
    const v = await call("verify");
    console.log(`Checked ${v.totalObjects} files: ${v.ok} OK, ${v.missingCount} missing, ${v.sizeMismatchCount} size mismatch`);
    for (const k of v.missing.slice(0, 20)) console.log(`  missing: ${k}`);
    for (const m of v.sizeMismatch.slice(0, 20)) console.log(`  mismatch: ${m.key} (bucket ${m.source}, disk ${m.local})`);
    process.exit(v.missingCount || v.sizeMismatchCount ? 1 : 0);
  } else if (action === "fix-refs" || action === "fix-refs-apply") {
    const r = await call(action);
    console.log(`${r.dryRun ? "Dry run" : "Applied"}: ${r.valuesToFix} saved link(s) to rewrite`);
    for (const [table, n] of Object.entries(r.rowsToFix)) console.log(`  ${table}: ${n} row(s) of ${r.scanned[table]}`);
    for (const s of r.samples.slice(0, 10)) console.log(`  ${s.table}.${s.column} ${s.id}\n    ${s.before}\n    → ${s.after}`);
    for (const e of r.errors) console.error(`  error: ${e}`);
    process.exit(r.errors.length ? 1 : 0);
  } else if (action === "status") {
    printStatus(await call("status"));
  } else {
    const r = await call("start");
    console.log(r.started ? "Copy started." : "A copy is already running; following it.");
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await call("status");
      printStatus(s);
      if (s.state !== "running") process.exit(s.state === "done" ? 0 : 1);
    }
  }
} catch (err) {
  console.error(`Request failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
