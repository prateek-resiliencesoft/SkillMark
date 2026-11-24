"use client";

import {
  DataTableWrapper,
  EmptyState,
  FilterBar,
  StatCard,
  TableHeadRow,
  TableRow,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUG_SEVERITIES, type BugSeverity } from "@/lib/bug-triage/types";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ExternalLink, MessageSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

const TRIGGER = "h-9 w-[150px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80";

const SEV_STYLE: Record<BugSeverity, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export function AiTriageBucketsPanel() {
  const [severity, setSeverity] = useState("all");
  const [hasIssue, setHasIssue] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());

  const listInput = useMemo(
    () => ({
      severity: severity === "all" ? undefined : (severity as BugSeverity),
      hasIssue: hasIssue === "all" ? undefined : hasIssue === "yes",
      search: search || undefined,
    }),
    [severity, hasIssue, search],
  );

  const bucketsQ = trpc.bugTriage.bucketsList.useQuery(listInput, {
    staleTime: 10_000,
    keepPreviousData: true,
  });

  const buckets = bucketsQ.data?.buckets ?? [];
  const withIssues = buckets.filter((b) => b.githubIssueNumber != null).length;
  const hot = buckets.filter((b) => b.count7d > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Open buckets" value={buckets.length} icon={Sparkles} loading={bucketsQ.isLoading} />
        <StatCard title="With GitHub issue" value={withIssues} icon={ExternalLink} loading={bucketsQ.isLoading} />
        <StatCard
          title={`Active (${bucketsQ.data?.settingsWindowDays ?? 7}d)`}
          value={hot}
          icon={MessageSquare}
          loading={bucketsQ.isLoading}
        />
      </div>

      {!bucketsQ.data?.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          Triage tables not applied yet. Run <code>db/init/44-bug-triage.sql</code> (or <code>npm run db:migrate</code>).
        </div>
      ) : null}

      <FilterBar>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className={TRIGGER}>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {BUG_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={hasIssue} onValueChange={setHasIssue}>
          <SelectTrigger className={TRIGGER}>
            <SelectValue placeholder="GitHub" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any GitHub state</SelectItem>
            <SelectItem value="yes">Has issue</SelectItem>
            <SelectItem value="no">No issue</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search title / key…"
          className="h-9 max-w-xs text-xs"
        />
      </FilterBar>

      <DataTableWrapper>
        <table className="w-full text-sm">
          <thead>
            <TableHeadRow>
              <th className="px-3 py-2 text-left font-medium">Bug</th>
              <th className="px-3 py-2 text-left font-medium">Severity</th>
              <th className="px-3 py-2 text-right font-medium">Count</th>
              <th className="px-3 py-2 text-left font-medium">GitHub</th>
              <th className="px-3 py-2 text-left font-medium">Updated</th>
            </TableHeadRow>
          </thead>
          <tbody>
            {bucketsQ.isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : buckets.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    title="No buckets yet"
                    description="New feedback and error logs enqueue here for AI clustering."
                  />
                </td>
              </tr>
            ) : (
              buckets.map((b) => (
                <TableRow key={b.id}>
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-medium">{b.title}</div>
                    <div className="font-mono text-xs text-muted-foreground">{b.bugKey}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{b.summary}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Badge className={cn("border-0 capitalize", SEV_STYLE[b.severity])}>{b.severity}</Badge>
                  </td>
                  <td className="px-3 py-2.5 align-top text-right tabular-nums">{b.count7d}</td>
                  <td className="px-3 py-2.5 align-top">
                    {b.githubIssueUrl ? (
                      <Link
                        href={b.githubIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        #{b.githubIssueNumber}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-xs text-muted-foreground">{formatWhen(b.updatedAt)}</td>
                </TableRow>
              ))
            )}
          </tbody>
        </table>
      </DataTableWrapper>
    </div>
  );
}
