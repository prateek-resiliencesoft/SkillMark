import "server-only";
import { createLogger } from "@/lib/logger";
import { nanoid } from "@/lib/id";
import { deletePrefixStats } from "@/lib/storage";
import type { Context } from "@/server/context";

const log = createLogger("organization-purge");
type Db = Context["supabase"];

export type PurgeResult = {
  objects: number;
  bytes: number;
  interviews: number;
  /** false when the org row had to be kept as an empty removed shell. */
  rowDeleted: boolean;
};

/**
 * Permanently delete an organization and everything in it:
 *  - every file in the bucket under orgs/{id}/ (recordings, images, CVs, form uploads)
 *  - all interviews of its projects, with questions, sessions, messages, candidates, error logs
 *  - the organization row itself, which cascades to projects, members, invites, forms,
 *    applications, API keys, webhooks, question bank, feedback and billing rows.
 *
 * `interviews.projectId` is ON DELETE SET NULL, so interviews must be deleted explicitly
 * or they would be left behind orphaned. Safe to re-run if a previous attempt failed halfway.
 * Platform audit entries are intentionally kept.
 */
export async function purgeOrganization(
  supabase: Db,
  org: { id: string },
): Promise<PurgeResult> {
  // 1. Bucket files first (they are located through the org id, not the DB rows).
  const media = await deletePrefixStats(`orgs/${org.id}/`);

  // 2. Interviews (cascade to questions, sessions, messages, candidates, ...).
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organizationId", org.id);
  const projectIds = (projects ?? []).map((p) => p.id as string);

  let interviews = 0;
  for (let i = 0; i < projectIds.length; i += 50) {
    const { data: rows } = await supabase
      .from("interviews")
      .select("id")
      .in("projectId", projectIds.slice(i, i + 50));
    const ids = (rows ?? []).map((r) => r.id as string);
    for (let j = 0; j < ids.length; j += 100) {
      const chunk = ids.slice(j, j + 100);
      const { error } = await supabase.from("interviews").delete().in("id", chunk);
      if (error) throw new Error(`Could not delete interviews: ${error.message}`);
      interviews += chunk.length;
    }
  }

  // 3. The organization row (cascades the rest).
  const { error } = await supabase.from("organizations").delete().eq("id", org.id);
  if (error) {
    // Data is already gone; keep an anonymous removed shell so the org stays out of service.
    log.warn(`Could not delete organization row ${org.id}: ${error.message}. Keeping removed shell.`);
    await supabase
      .from("organizations")
      .update({
        status: "DELETED",
        name: "Deleted organization",
        slug: `deleted-${org.id.slice(0, 8)}-${nanoid(4)}`,
      })
      .eq("id", org.id);
    await supabase.from("organization_members").delete().eq("organizationId", org.id);
    await supabase.from("organization_invites").delete().eq("organizationId", org.id);
    return { ...media, interviews, rowDeleted: false };
  }

  log.info(`Purged organization ${org.id}: ${interviews} interview(s), ${media.objects} object(s), ${media.bytes} bytes`);
  return { ...media, interviews, rowDeleted: true };
}
