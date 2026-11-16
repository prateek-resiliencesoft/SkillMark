"use client";

import { adminActionLabel } from "@/lib/admin-actions";
import { BklitStatCard } from "@/components/dashboard/bklit-stat-card";
import {
  CHART_COLORS,
  PageHeader,
  Panel,
  STATUS_COLORS,
  STATUS_LABEL,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Building2, CheckCircle2, Radio, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const RANGES = [7, 30, 90] as const;

function shortDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AdminOverviewPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const overview = trpc.platform.overview.useQuery(undefined, { staleTime: 15_000 });
  const stats = trpc.platformOps.overviewStats.useQuery(
    { days, timeZone },
    { staleTime: 30_000, keepPreviousData: true },
  );
  const audit = trpc.platform.recentAudit.useQuery({ limit: 8 }, { staleTime: 15_000 });

  const daily = stats.data?.daily ?? [];
  const spark = daily.map((d) => d.sessions);
  const sparkDone = daily.map((d) => d.completed);
  const statusTotal = (stats.data?.statuses ?? []).reduce((a, s) => a + s.count, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Interviews and organizations across this ResilienceSoft Interview instance."
        actions={
          <>
            <div className="flex rounded-lg border p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDays(r)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium",
                    days === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r} days
                </button>
              ))}
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/organizations">Organizations</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BklitStatCard
          title="Organizations"
          value={overview.data?.organizations}
          subtitle={`${overview.data?.paused ?? 0} paused`}
          icon={Building2}
          accentColor="#5941F2"
          loading={overview.isLoading}
        />
        <BklitStatCard
          title="People"
          value={overview.data?.people}
          subtitle="accounts"
          icon={Users}
          accentColor="#296CF2"
          loading={overview.isLoading}
        />
        <BklitStatCard
          title={`Sessions, last ${days} days`}
          value={stats.data?.totals.sessions}
          subtitle={`${stats.data?.totals.interviewsCreated ?? 0} new interviews`}
          icon={Radio}
          sparklineData={spark}
          accentColor="#277FF2"
          loading={stats.isLoading}
        />
        <BklitStatCard
          title="Completed"
          value={stats.data?.totals.completed}
          subtitle={
            stats.data?.totals.completionRate != null
              ? `${stats.data.totals.completionRate}% of sessions`
              : "no sessions yet"
          }
          icon={CheckCircle2}
          sparklineData={sparkDone}
          accentColor="#16a34a"
          loading={stats.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Sessions per day"
          description={`All organizations, last ${days} days. Live now: ${overview.data?.liveSessions ?? 0}.`}
          className="lg:col-span-2"
        >
          {stats.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adm-sessions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(v) => shortDay(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="sessions" name="Sessions" stroke={CHART_COLORS[0]} fill="url(#adm-sessions)" strokeWidth={2} />
                  <Area type="monotone" dataKey="completed" name="Completed" stroke="#16a34a" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Session status" description={`${statusTotal} sessions in range`}>
          {stats.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ul className="space-y-4">
              {(stats.data?.statuses ?? []).map((s) => {
                const pct = statusTotal ? Math.round((s.count / statusTotal) * 100) : 0;
                return (
                  <li key={s.status} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} />
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.count} · {pct}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: STATUS_COLORS[s.status] }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Usage by organization" description={`Sessions in the last ${days} days`}>
          {stats.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (stats.data?.byOrg ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No sessions in this range.</p>
          ) : (
            <div style={{ height: Math.max(160, (stats.data?.byOrg.length ?? 0) * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.data?.byOrg} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="sessions" name="Sessions" radius={[0, 4, 4, 0]}>
                    {(stats.data?.byOrg ?? []).map((o, i) => (
                      <Cell key={o.id} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title="Recent admin actions"
          actions={
            <Link href="/admin/activity" className="text-xs text-muted-foreground hover:text-foreground">
              View all
            </Link>
          }
          contentClassName="p-0"
        >
          {audit.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No admin actions yet.</p>
          ) : (
            <ul className="divide-y border-t">
              {(audit.data ?? []).map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{adminActionLabel(row.action)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.actorName}
                      {typeof row.meta?.name === "string" ? ` · ${row.meta.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(row.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
