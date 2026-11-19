"use client";

import { adminActionLabel } from "@/lib/admin-actions";
import {
  CHART_COLORS,
  PageHeader,
  Panel,
  STATUS_COLORS,
  STATUS_LABEL,
  StatCard,
  TacticalButton,
  formatWhen,
} from "@/components/admin/admin-ui";
import { StorageCapAlert } from "@/components/admin/storage-usage-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Layers,
  Radio,
  RefreshCw,
  Users,
} from "lucide-react";
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
  const statusTotal = (stats.data?.statuses ?? []).reduce((a, s) => a + s.count, 0);

  const handleRefresh = () => {
    overview.refetch();
    stats.refetch();
    audit.refetch();
  };

  const isFetching = overview.isFetching || stats.isFetching || audit.isFetching;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        kicker="Mission Control"
        title="Platform Overview"
        description="Real-time telemetry, session throughput, and organization health across this instance."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Days Segmented Controller */}
            <div className="flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 dark:border-white/[0.08] dark:bg-zinc-900/80">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDays(r)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-semibold transition-all duration-150 active:scale-95",
                    days === r
                      ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>

            {/* Quick Refresh Button */}
            <TacticalButton
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="h-8 gap-1.5 px-3 text-xs"
              title="Refresh telemetry"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin text-primary")} />
              <span className="hidden sm:inline">Refresh</span>
            </TacticalButton>

            <TacticalButton asChild variant="outline" size="sm" className="h-8 text-xs">
              <Link href="/admin/organizations" className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                <span>Organizations</span>
              </Link>
            </TacticalButton>
          </div>
        }
      />

      <StorageCapAlert />

      {/* KPI Stat Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Organizations"
          value={overview.data?.organizations}
          subtitle={
            <span className="flex items-center justify-between">
              <span>{overview.data?.paused ?? 0} paused / suspended</span>
              <span className="font-semibold text-emerald-500">Active</span>
            </span>
          }
          icon={Building2}
          accentColor="#5941F2"
          loading={overview.isLoading}
        />

        <StatCard
          title="People Accounts"
          value={overview.data?.people}
          subtitle="Registered operators & team members"
          icon={Users}
          accentColor="#296CF2"
          loading={overview.isLoading}
        />

        <StatCard
          title={`Sessions (${days}d)`}
          value={stats.data?.totals.sessions}
          subtitle={`${stats.data?.totals.interviewsCreated ?? 0} new interviews staged`}
          icon={Radio}
          accentColor="#8B5CF6"
          loading={stats.isLoading}
          badge={
            overview.data?.liveSessions ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {overview.data.liveSessions} Live
              </span>
            ) : null
          }
        />

        <StatCard
          title="Completed Interviews"
          value={stats.data?.totals.completed}
          subtitle={
            stats.data?.totals.completionRate != null
              ? `${stats.data.totals.completionRate}% completion rate`
              : "No sessions recorded"
          }
          icon={CheckCircle2}
          accentColor="#10b981"
          loading={stats.isLoading}
          trend={stats.data?.totals.completionRate != null ? `${stats.data.totals.completionRate}%` : undefined}
          trendDirection={stats.data?.totals.completionRate && stats.data.totals.completionRate > 70 ? "up" : "neutral"}
        />
      </div>

      {/* Primary Analytics Section */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Daily Session Timeline */}
        <Panel
          kicker="Timeline"
          title="Daily Session Flow"
          description={`Cumulative throughput across all organizations over the last ${days} days.`}
          className="lg:col-span-2"
          actions={
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[0] }} />
                Total Sessions
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Completed
              </span>
            </div>
          }
        >
          {stats.isLoading ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : (
            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adm-sessions-glow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="adm-completed-glow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50 dark:stroke-white/[0.05]" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={shortDay}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                    minTickGap={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    labelFormatter={(v) => shortDay(String(v))}
                    contentStyle={{
                      backgroundColor: "rgba(10, 10, 12, 0.95)",
                      borderColor: "rgba(255, 255, 255, 0.12)",
                      borderRadius: "10px",
                      fontSize: "12px",
                      color: "#fff",
                      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sessions"
                    name="Total Sessions"
                    stroke={CHART_COLORS[0]}
                    fill="url(#adm-sessions-glow)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="Completed"
                    stroke="#10b981"
                    fill="url(#adm-completed-glow)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* Status Distribution */}
        <Panel
          kicker="Breakdown"
          title="Session Statuses"
          description={`${statusTotal} total sessions analyzed.`}
        >
          {stats.isLoading ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : (
            <ul className="space-y-4 pt-1">
              {(stats.data?.statuses ?? []).map((s) => {
                const pct = statusTotal ? Math.round((s.count / statusTotal) * 100) : 0;
                const color = STATUS_COLORS[s.status] ?? "#6b7280";
                return (
                  <li key={s.status} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {s.count} <span className="opacity-50">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full border border-border/40 bg-muted/50 dark:border-white/[0.04] dark:bg-zinc-900">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Secondary Operations Grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Usage by Org */}
        <Panel
          kicker="Tenants"
          title="Sessions by Organization"
          description={`Volume distribution across active tenant environments.`}
        >
          {stats.isLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : (stats.data?.byOrg ?? []).length === 0 ? (
            <p className="py-12 text-center text-xs text-muted-foreground">
              No session activity registered in this time period.
            </p>
          ) : (
            <div style={{ height: Math.max(180, (stats.data?.byOrg.length ?? 0) * 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.data?.byOrg}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/40 dark:stroke-white/[0.05]" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "currentColor" }} className="text-muted-foreground" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-foreground font-medium"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(10, 10, 12, 0.95)",
                      borderColor: "rgba(255, 255, 255, 0.12)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#fff",
                    }}
                  />
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

        {/* Recent Admin Audit Activity */}
        <Panel
          kicker="Security"
          title="Recent Audit Activity"
          description="Privileged actions and configuration changes."
          actions={
            <Link
              href="/admin/activity"
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>View full log</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          }
          contentClassName="p-0"
        >
          {audit.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              No recent administrative actions recorded.
            </p>
          ) : (
            <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
              {(audit.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-xs transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-semibold text-foreground">
                      {adminActionLabel(row.action)}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">{row.actorName}</span>
                      {typeof row.meta?.name === "string" ? ` · ${row.meta.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {formatWhen(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
