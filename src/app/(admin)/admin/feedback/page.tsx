"use client";

import {
  DataTableWrapper,
  EmptyState,
  FilterBar,
  PageHeader,
  StatCard,
  TableHeadRow,
  TableRow,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { MessageSquareText, Star, Tag } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const RANGES: Record<string, { label: string; days: number | null }> = {
  all: { label: "All time", days: null },
  "1": { label: "Today", days: 1 },
  "7": { label: "Last 7 days", days: 7 },
  "30": { label: "Last 30 days", days: 30 },
  "90": { label: "Last 90 days", days: 90 },
};

const TRIGGER = "h-9 w-[170px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80";

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("h-3.5 w-3.5", n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}

export default function AdminFeedbackPage() {
  const [org, setOrg] = useState("all");
  const [rating, setRating] = useState("all");
  const [range, setRange] = useState("all");
  const [search, setSearch] = useState("");

  const input = useMemo(() => {
    const days = RANGES[range]?.days;
    let from: string | undefined;
    if (days) {
      const d = new Date();
      if (days === 1) d.setHours(0, 0, 0, 0);
      else d.setDate(d.getDate() - days);
      from = d.toISOString();
    }
    return {
      organizationId: org === "all" ? undefined : org,
      rating: rating === "all" ? undefined : Number(rating),
      from,
      search: search.trim() || undefined,
    };
  }, [org, rating, range, search]);

  const q = trpc.platformOps.feedbackList.useQuery(input, { staleTime: 10_000, keepPreviousData: true });
  const data = q.data;
  const summary = data?.summary;
  const maxCount = Math.max(1, ...(summary?.distribution.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Candidates"
        title="Feedback"
        description="What candidates said on the thank-you screen after their interview."
      />

      {data && !data.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          Feedback storage is not set up on this database yet. Apply <code>db/init/30-candidate-feedback.sql</code>; until then
          candidates don&apos;t see the form.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Total feedback" value={summary?.total ?? null} icon={MessageSquareText} loading={q.isLoading} />
        <StatCard
          title="Average rating"
          value={summary?.average != null ? `${summary.average.toFixed(1)} / 5` : "—"}
          icon={Star}
          loading={q.isLoading}
        />
        <StatCard
          title="Top tag"
          value={summary?.topTags[0]?.tag ?? "—"}
          subtitle={summary?.topTags[0] ? `${summary.topTags[0].count} mention${summary.topTags[0].count === 1 ? "" : "s"}` : undefined}
          icon={Tag}
          loading={q.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50">
          <p className="mb-3 text-sm font-semibold">Ratings</p>
          {q.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-2">
              {(summary?.distribution ?? []).map((d) => (
                <div key={d.rating} className="flex items-center gap-3 text-xs">
                  <span className="w-12 shrink-0 font-medium">{d.rating} star{d.rating > 1 ? "s" : ""}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums text-muted-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50">
          <p className="mb-3 text-sm font-semibold">Top tags</p>
          {q.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : summary?.topTags.length ? (
            <div className="flex flex-wrap gap-2">
              {summary.topTags.map((t) => (
                <Badge key={t.tag} variant="outline" className="font-normal">
                  {t.tag} <span className="ml-1.5 text-muted-foreground">{t.count}</span>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No tags yet.</p>
          )}
        </div>
      </div>

      <FilterBar
        query={search}
        onQueryChange={setSearch}
        placeholder="Search comment, candidate, org, interview"
        resultCount={data?.rows.length}
        onClear={() => {
          setOrg("all");
          setRating("all");
          setRange("all");
          setSearch("");
        }}
      >
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className={TRIGGER} aria-label="Organization">
            <SelectValue placeholder="Organization" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All organizations</SelectItem>
            {(data?.orgs ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rating} onValueChange={setRating}>
          <SelectTrigger className={TRIGGER} aria-label="Rating">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All ratings</SelectItem>
            {[5, 4, 3, 2, 1].map((r) => (
              <SelectItem key={r} value={String(r)}>
                {r} star{r > 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className={TRIGGER} aria-label="Date range">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            {Object.entries(RANGES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !data?.rows.length ? (
        <div className="rounded-xl border border-border/70 bg-card dark:border-white/[0.08]">
          <EmptyState icon={MessageSquareText} title="No feedback yet" description="Feedback appears here after candidates finish an interview and send it." />
        </div>
      ) : (
        <DataTableWrapper>
          <TableHeadRow>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Organization</th>
            <th className="px-4 py-3">Interview</th>
            <th className="px-4 py-3">Rating</th>
            <th className="px-4 py-3">Tags</th>
            <th className="px-4 py-3">Comment</th>
            <th className="px-4 py-3" />
          </TableHeadRow>
          <tbody>
            {data.rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-muted-foreground">{formatWhen(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{r.candidateName ?? "—"}</p>
                  {r.candidateEmail ? <p className="text-muted-foreground">{r.candidateEmail}</p> : null}
                </td>
                <td className="px-4 py-3">
                  {r.organizationId ? (
                    <Link href={`/admin/organizations/${r.organizationId}`} className="hover:underline">
                      {r.organizationName ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">{r.interviewTitle ?? "—"}</td>
                <td className="px-4 py-3">
                  <Stars value={r.rating} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex max-w-[220px] flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="max-w-[320px] whitespace-pre-line px-4 py-3">{r.comment ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {r.interviewId ? (
                    <Link href={`/interviews/${r.interviewId}/results?session=${r.sessionId}`} className="text-primary hover:underline">
                      Session
                    </Link>
                  ) : null}
                </td>
              </TableRow>
            ))}
          </tbody>
        </DataTableWrapper>
      )}
    </div>
  );
}
