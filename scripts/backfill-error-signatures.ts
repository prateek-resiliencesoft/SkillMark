/**
 * One-off: fill session_error_logs.signature for rows written before the
 * Error Logs page existed. Safe to re-run; it only touches rows with a NULL
 * signature.
 *
 *   npx tsx --env-file=.env scripts/backfill-error-signatures.ts
 *
 * Needs the same env as the app (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
 * Run after db/init/36-error-log-signatures.sql.
 */
import { errorSignature } from "../src/lib/session-error-log";
import { supabaseAdmin } from "../src/lib/supabase/admin";

const BATCH = 1000;

type Row = { id: string; category: string; source: string; message: string };

async function main() {
  let total = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("session_error_logs")
      .select("id, category, source, message")
      .is("signature", null)
      .limit(BATCH);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;

    // Rows in one batch that share a signature get one update each.
    const bySig = new Map<string, string[]>();
    for (const r of rows) {
      const sig = errorSignature({ category: r.category, source: r.source, message: r.message });
      const ids = bySig.get(sig) ?? [];
      ids.push(r.id);
      bySig.set(sig, ids);
    }
    for (const [signature, ids] of bySig) {
      const { error: upErr } = await supabaseAdmin.from("session_error_logs").update({ signature }).in("id", ids);
      if (upErr) throw new Error(upErr.message);
    }
    total += rows.length;
    console.log(`filled ${total} rows`);
  }
  console.log(total ? `Done. ${total} rows backfilled.` : "Nothing to backfill.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
