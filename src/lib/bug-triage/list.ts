import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadBugTriageSettings } from "./settings";
import { isBugSeverity, type BugBucketRow, type BugSeverity } from "./types";

export type BucketListItem = BugBucketRow & { count7d: number };

export async function listBugBuckets(opts: {
  severity?: BugSeverity;
  hasIssue?: boolean;
  search?: string;
  limit?: number;
}): Promise<{ available: boolean; settingsWindowDays: number; buckets: BucketListItem[] }> {
  const settings = await loadBugTriageSettings();
  const windowStart = new Date(Date.now() - settings.windowDays * 24 * 60 * 60 * 1000).toISOString();
  let q = supabaseAdmin
    .from("bug_buckets")
    .select("id, bugKey, title, severity, summary, githubIssueNumber, githubIssueUrl, lastCommentedAt, createdAt, updatedAt")
    .order("updatedAt", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.severity) q = q.eq("severity", opts.severity);
  if (opts.hasIssue === true) q = q.not("githubIssueNumber", "is", null);
  if (opts.hasIssue === false) q = q.is("githubIssueNumber", null);
  if (opts.search?.trim()) {
    const s = opts.search.trim();
    q = q.or(`title.ilike.%${s}%,bugKey.ilike.%${s}%,summary.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01") return { available: false, settingsWindowDays: settings.windowDays, buckets: [] };
    throw error;
  }

  const rows = (data ?? []).filter((r) => isBugSeverity(r.severity)) as unknown as BugBucketRow[];
  const withCounts: BucketListItem[] = [];
  for (const b of rows) {
    const { count } = await supabaseAdmin
      .from("triage_events")
      .select("id", { count: "exact", head: true })
      .eq("bucketId", b.id)
      .eq("status", "done")
      .gte("createdAt", windowStart);
    withCounts.push({ ...b, count7d: count ?? 0 });
  }

  withCounts.sort((a, b) => b.count7d - a.count7d || b.updatedAt.localeCompare(a.updatedAt));
  return { available: true, settingsWindowDays: settings.windowDays, buckets: withCounts };
}

export async function getBugBucketDetail(id: string) {
  const settings = await loadBugTriageSettings();
  const windowStart = new Date(Date.now() - settings.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: bucket, error } = await supabaseAdmin.from("bug_buckets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!bucket) return null;
  const { data: events } = await supabaseAdmin
    .from("triage_events")
    .select("id, source, sourceId, payload, createdAt, status")
    .eq("bucketId", id)
    .gte("createdAt", windowStart)
    .order("createdAt", { ascending: false })
    .limit(50);
  return { bucket, events: events ?? [], windowDays: settings.windowDays };
}
