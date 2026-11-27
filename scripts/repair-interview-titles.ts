/**
 * Strip PDF page-marker junk from batch interview titles
 * (e.g. "Role · <!-- page 1 -->" → "Role").
 *
 *   npx tsx --env-file=.env scripts/repair-interview-titles.ts
 *   npx tsx --env-file=.env scripts/repair-interview-titles.ts --apply
 */
import { cleanInterviewTitle } from "../src/lib/documents/candidate-name";
import { supabaseAdmin } from "../src/lib/supabase/admin";

const APPLY = process.argv.includes("--apply");

async function main() {
  const { data, error } = await supabaseAdmin
    .from("interviews")
    .select("id, title, batchId")
    .not("batchId", "is", null)
    .order("createdAt", { ascending: false })
    .limit(3000);
  if (error) throw new Error(error.message);

  const updates: { id: string; from: string; to: string }[] = [];
  for (const row of data ?? []) {
    const from = String(row.title ?? "");
    const to = cleanInterviewTitle(from);
    if (!to || to === from) continue;
    if (!/<!--|page\s*\d+/i.test(from) && to === from) continue;
    updates.push({ id: row.id as string, from, to });
  }

  if (!updates.length) {
    console.log("No interview titles with page-marker junk found.");
    return;
  }

  console.log(APPLY ? "Updated:" : "Would update (dry run):");
  for (const u of updates) {
    console.log(`  ${u.id}\n    ${JSON.stringify(u.from)}\n →  ${JSON.stringify(u.to)}`);
    if (APPLY) {
      const { error: upErr } = await supabaseAdmin
        .from("interviews")
        .update({ title: u.to, updatedAt: new Date().toISOString() })
        .eq("id", u.id);
      if (upErr) throw new Error(`${u.id}: ${upErr.message}`);
    }
  }
  if (!APPLY) console.log("\nRe-run with --apply to write these changes.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
