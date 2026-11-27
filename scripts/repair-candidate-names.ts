/**
 * Fix candidate rows whose name was stored as a page marker or other
 * placeholder (e.g. "Page 1", "<!-- page 1 -->", "Resume").
 *
 * Recomputes the name from the stored CV text, then the email local part,
 * then the original filename. Does not call any AI.
 *
 *   npx tsx --env-file=.env scripts/repair-candidate-names.ts          # dry run
 *   npx tsx --env-file=.env scripts/repair-candidate-names.ts --apply  # write updates
 *
 * Run this on the machine that holds the database you want to fix (laptop
 * or VPS). Review the dry-run table before passing --apply. You can also
 * edit the two names in the batch screen instead of running this.
 */
import { isJunkStoredName, resolveCandidateName } from "../src/lib/documents/candidate-name";
import { supabaseAdmin } from "../src/lib/supabase/admin";

const APPLY = process.argv.includes("--apply");

type Row = {
  id: string;
  name: string;
  email: string | null;
  batchId: string | null;
  createdAt: string;
  profile: { resumeMarkdown?: string; fileName?: string; name?: string } | null;
};

async function main() {
  const { data, error } = await supabaseAdmin
    .from("candidates")
    .select("id, name, email, batchId, createdAt, profile")
    .order("createdAt", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as Row[]).filter((r) => isJunkStoredName(r.name));
  if (!rows.length) {
    console.log("No candidates with placeholder names were found.");
    return;
  }

  const updates: { id: string; from: string; to: string; via: string }[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];

  for (const row of rows) {
    const profile = row.profile && typeof row.profile === "object" ? row.profile : {};
    const resolved = resolveCandidateName({
      candidate: null,
      source: typeof profile.resumeMarkdown === "string" ? profile.resumeMarkdown : "",
      email: row.email,
      fileName: typeof profile.fileName === "string" ? profile.fileName : null,
    });
    if (!resolved.name || resolved.name === row.name) {
      skipped.push({ id: row.id, name: row.name, reason: "could not infer a better name" });
      continue;
    }
    updates.push({ id: row.id, from: row.name, to: resolved.name, via: resolved.source ?? "unknown" });
    if (APPLY) {
      const nextProfile = {
        ...profile,
        name: resolved.name,
      };
      const { error: upErr } = await supabaseAdmin
        .from("candidates")
        .update({ name: resolved.name, profile: nextProfile, updatedAt: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) throw new Error(`${row.id}: ${upErr.message}`);
    }
  }

  if (updates.length) {
    console.log(APPLY ? "Updated:" : "Would update (dry run):");
    for (const u of updates) {
      console.log(`  ${u.id}  ${JSON.stringify(u.from)}  →  ${JSON.stringify(u.to)}  (${u.via})`);
    }
  }
  if (skipped.length) {
    console.log("Left unchanged:");
    for (const s of skipped) {
      console.log(`  ${s.id}  ${JSON.stringify(s.name)}  (${s.reason})`);
    }
  }
  if (!APPLY && updates.length) {
    console.log("\nRe-run with --apply to write these changes.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
