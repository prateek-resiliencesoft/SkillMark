import "server-only";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyTriageEvent, type OpenBucketHint } from "./classify";
import { commentGithubIssue, createGithubIssue, githubConfigured } from "./github";
import { loadBugTriageSettings } from "./settings";
import {
  isBugSeverity,
  shouldRaiseGithubIssue,
  type BugSeverity,
  type TriageEventPayload,
} from "./types";

const log = createLogger("bug-triage/worker");
const BATCH = 20;
const MAX_ATTEMPTS = 5;
const COMMENT_COOLDOWN_MS = 60 * 60 * 1000;

export type WorkerResult = {
  enabled: boolean;
  claimed: number;
  processed: number;
  skipped: number;
  failed: number;
  issuesCreated: number;
  issuesCommented: number;
};

type EventRow = {
  id: string;
  source: string;
  sourceId: string;
  payload: TriageEventPayload;
  attempts: number;
};

export async function runBugTriageWorker(): Promise<WorkerResult> {
  const settings = await loadBugTriageSettings();
  const empty: WorkerResult = {
    enabled: settings.enabled,
    claimed: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    issuesCreated: 0,
    issuesCommented: 0,
  };
  if (!settings.enabled) return empty;

  const claimed = await claimPendingEvents(BATCH);
  empty.claimed = claimed.length;
  if (!claimed.length) return empty;

  const openBuckets = await loadOpenBucketHints();
  const windowStart = new Date(Date.now() - settings.windowDays * 24 * 60 * 60 * 1000).toISOString();

  for (const ev of claimed) {
    try {
      const classified = await classifyTriageEvent({
        source: ev.source,
        payload: ev.payload ?? {},
        openBuckets,
      });

      if (!classified.isBug) {
        await markEvent(ev.id, { status: "skipped", processedAt: new Date().toISOString() });
        empty.skipped++;
        continue;
      }

      const bucket = await upsertBucket(classified, openBuckets);
      await markEvent(ev.id, {
        status: "done",
        bucketId: bucket.id,
        processedAt: new Date().toISOString(),
      });
      empty.processed++;

      // Refresh hint list so later events in this batch can match.
      const hintIdx = openBuckets.findIndex((b) => b.id === bucket.id);
      const hint: OpenBucketHint = {
        id: bucket.id,
        bugKey: bucket.bugKey,
        title: bucket.title,
        severity: bucket.severity,
        summary: bucket.summary,
      };
      if (hintIdx >= 0) openBuckets[hintIdx] = hint;
      else openBuckets.unshift(hint);

      const count = await countEventsInWindow(bucket.id, windowStart);
      if (!shouldRaiseGithubIssue(bucket.severity, count, settings)) continue;
      if (!githubConfigured()) {
        log.warn("threshold met but GitHub not configured — skipping issue");
        continue;
      }

      const samples = await sampleEvents(bucket.id, windowStart, 5);
      if (bucket.githubIssueNumber) {
        const last = bucket.lastCommentedAt ? Date.parse(bucket.lastCommentedAt) : 0;
        if (Date.now() - last < COMMENT_COOLDOWN_MS) continue;
        const body = buildCommentBody({
          severity: bucket.severity,
          count,
          windowDays: settings.windowDays,
          summary: bucket.summary,
          samples,
        });
        await commentGithubIssue({ issueNumber: bucket.githubIssueNumber, body });
        await supabaseAdmin
          .from("bug_buckets")
          .update({ lastCommentedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          .eq("id", bucket.id);
        empty.issuesCommented++;
      } else {
        const issue = await createGithubIssue({
          title: `[auto-triage][${bucket.severity}] ${bucket.title}`,
          body: buildIssueBody({
            bugKey: bucket.bugKey,
            severity: bucket.severity,
            count,
            windowDays: settings.windowDays,
            summary: bucket.summary,
            samples,
          }),
          labels: ["auto-triage", bucket.severity],
        });
        await supabaseAdmin
          .from("bug_buckets")
          .update({
            githubIssueNumber: issue.number,
            githubIssueUrl: issue.htmlUrl,
            lastCommentedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .eq("id", bucket.id);
        bucket.githubIssueNumber = issue.number;
        bucket.githubIssueUrl = issue.htmlUrl;
        empty.issuesCreated++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`event ${ev.id} failed: ${msg}`);
      const attempts = (ev.attempts ?? 0) + 1;
      await markEvent(ev.id, {
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        error: msg.slice(0, 500),
        attempts,
        processedAt: new Date().toISOString(),
      });
      empty.failed++;
    }
  }

  return empty;
}

async function claimPendingEvents(limit: number): Promise<EventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("triage_events")
    .select("id, source, sourceId, payload, attempts")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("createdAt", { ascending: true })
    .limit(limit);
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  const rows = (data ?? []) as EventRow[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  await supabaseAdmin.from("triage_events").update({ status: "processing" }).in("id", ids).eq("status", "pending");
  return rows;
}

async function loadOpenBucketHints(): Promise<OpenBucketHint[]> {
  const { data, error } = await supabaseAdmin
    .from("bug_buckets")
    .select("id, bugKey, title, severity, summary")
    .order("updatedAt", { ascending: false })
    .limit(40);
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return (data ?? [])
    .filter((r) => isBugSeverity(r.severity))
    .map((r) => ({
      id: r.id as string,
      bugKey: r.bugKey as string,
      title: r.title as string,
      severity: r.severity as BugSeverity,
      summary: (r.summary as string) || "",
    }));
}

type BucketState = {
  id: string;
  bugKey: string;
  title: string;
  severity: BugSeverity;
  summary: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  lastCommentedAt: string | null;
};

async function upsertBucket(
  classified: {
    bugKey: string;
    title: string;
    severity: BugSeverity;
    summary: string;
    matchesBucketId: string | null;
  },
  openBuckets: OpenBucketHint[],
): Promise<BucketState> {
  if (classified.matchesBucketId) {
    const existing = await fetchBucket(classified.matchesBucketId);
    if (existing) {
      const severity = maxSeverity(existing.severity, classified.severity);
      const summary = classified.summary.slice(0, 2000) || existing.summary;
      await supabaseAdmin
        .from("bug_buckets")
        .update({
          severity,
          summary,
          title: existing.title || classified.title,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return { ...existing, severity, summary };
    }
  }

  const byKey = openBuckets.find((b) => b.bugKey === classified.bugKey);
  if (byKey) {
    const existing = await fetchBucket(byKey.id);
    if (existing) {
      const severity = maxSeverity(existing.severity, classified.severity);
      const summary = classified.summary.slice(0, 2000) || existing.summary;
      await supabaseAdmin
        .from("bug_buckets")
        .update({ severity, summary, updatedAt: new Date().toISOString() })
        .eq("id", existing.id);
      return { ...existing, severity, summary };
    }
  }

  const { data, error } = await supabaseAdmin
    .from("bug_buckets")
    .upsert(
      {
        bugKey: classified.bugKey,
        title: classified.title.slice(0, 160),
        severity: classified.severity,
        summary: classified.summary.slice(0, 2000),
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "bugKey" },
    )
    .select("id, bugKey, title, severity, summary, githubIssueNumber, githubIssueUrl, lastCommentedAt")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("bucket upsert returned no row");
  return {
    id: data.id as string,
    bugKey: data.bugKey as string,
    title: data.title as string,
    severity: data.severity as BugSeverity,
    summary: (data.summary as string) || "",
    githubIssueNumber: (data.githubIssueNumber as number | null) ?? null,
    githubIssueUrl: (data.githubIssueUrl as string | null) ?? null,
    lastCommentedAt: (data.lastCommentedAt as string | null) ?? null,
  };
}

async function fetchBucket(id: string): Promise<BucketState | null> {
  const { data, error } = await supabaseAdmin
    .from("bug_buckets")
    .select("id, bugKey, title, severity, summary, githubIssueNumber, githubIssueUrl, lastCommentedAt")
    .eq("id", id)
    .maybeSingle();
  if (error || !data || !isBugSeverity(data.severity)) return null;
  return {
    id: data.id as string,
    bugKey: data.bugKey as string,
    title: data.title as string,
    severity: data.severity as BugSeverity,
    summary: (data.summary as string) || "",
    githubIssueNumber: (data.githubIssueNumber as number | null) ?? null,
    githubIssueUrl: (data.githubIssueUrl as string | null) ?? null,
    lastCommentedAt: (data.lastCommentedAt as string | null) ?? null,
  };
}

async function countEventsInWindow(bucketId: string, windowStart: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("triage_events")
    .select("id", { count: "exact", head: true })
    .eq("bucketId", bucketId)
    .in("status", ["done", "processing"])
    .gte("createdAt", windowStart);
  if (error) throw error;
  return count ?? 0;
}

async function sampleEvents(
  bucketId: string,
  windowStart: string,
  limit: number,
): Promise<{ source: string; message: string; createdAt: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("triage_events")
    .select("source, payload, createdAt")
    .eq("bucketId", bucketId)
    .gte("createdAt", windowStart)
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as TriageEventPayload;
    return {
      source: r.source as string,
      message: (p.message || p.severityHint || "(no message)").slice(0, 300),
      createdAt: r.createdAt as string,
    };
  });
}

async function markEvent(
  id: string,
  patch: {
    status: string;
    bucketId?: string | null;
    error?: string | null;
    attempts?: number;
    processedAt?: string;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("triage_events").update(patch).eq("id", id);
  if (error) log.warn(`markEvent ${id}: ${error.message}`);
}

const SEVERITY_RANK: Record<BugSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

function maxSeverity(a: BugSeverity, b: BugSeverity): BugSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function buildIssueBody(opts: {
  bugKey: string;
  severity: BugSeverity;
  count: number;
  windowDays: number;
  summary: string;
  samples: { source: string; message: string; createdAt: string }[];
}): string {
  const samples = opts.samples
    .map((s) => `- (${s.source}, ${s.createdAt}) ${s.message}`)
    .join("\n");
  return [
    `## Auto-triaged bug`,
    ``,
    `**Bug key:** \`${opts.bugKey}\``,
    `**Severity:** ${opts.severity}`,
    `**Occurrences (last ${opts.windowDays}d):** ${opts.count}`,
    ``,
    `### What's happening`,
    opts.summary,
    ``,
    `### Recent samples`,
    samples || "_none_",
    ``,
    `### What needs fixing`,
    `Investigate the root cause from the samples above, reproduce if possible, and ship a fix. This issue was opened automatically by SkillMark bug triage when the rolling threshold was crossed.`,
    ``,
    `_Source: SkillMark /admin/ai_`,
  ].join("\n");
}

function buildCommentBody(opts: {
  severity: BugSeverity;
  count: number;
  windowDays: number;
  summary: string;
  samples: { source: string; message: string; createdAt: string }[];
}): string {
  const samples = opts.samples
    .map((s) => `- (${s.source}) ${s.message}`)
    .join("\n");
  return [
    `### Triage update`,
    `Severity **${opts.severity}** — **${opts.count}** hits in last ${opts.windowDays}d.`,
    ``,
    opts.summary,
    ``,
    `Recent samples:`,
    samples || "_none_",
  ].join("\n");
}
