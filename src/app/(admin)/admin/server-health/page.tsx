"use client";

import {
  Meter,
  PageHeader,
  Panel,
  TacticalButton,
  formatBytes,
  formatUptime,
} from "@/components/admin/admin-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { levelFor, type Level } from "@/lib/admin-stats";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  Info,
  Loader2,
  RefreshCw,
  Server,
  Zap,
} from "lucide-react";
import Link from "next/link";

const LEVEL_TEXT: Record<Level, string> = {
  ok: "Nominal",
  warn: "Elevated",
  critical: "Critical",
};

function TacticalGauge({
  label,
  icon: Icon,
  percent,
  detail,
  loading,
}: {
  label: string;
  icon: React.ElementType;
  percent: number | null;
  detail: string;
  loading: boolean;
}) {
  const level = levelFor(percent);
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-zinc-950/60 dark:backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground dark:border-white/[0.08] dark:bg-zinc-900">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>

        {!loading && percent != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
              level === "critical"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                : level === "warn"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                level === "critical"
                  ? "bg-rose-500 animate-pulse"
                  : level === "warn"
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
            />
            {LEVEL_TEXT[level]}
          </span>
        ) : null}
      </div>

      <div className="my-3 space-y-2">
        {loading ? (
          <Skeleton className="h-9 w-24 rounded-md" />
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="font-heading text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {percent == null ? "—" : Math.round(percent)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">%</span>
          </div>
        )}

        <Meter percent={loading ? 0 : percent} tone={level} />
      </div>

      <p className="text-[11px] text-muted-foreground font-mono truncate">
        {loading ? "Sampling telemetry…" : detail}
      </p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export default function ServerHealthPage() {
  const q = trpc.platformOps.hostHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });
  const h = q.data?.host;
  const loading = q.isLoading;
  const loadPct = h ? Math.min(100, (h.cpu.load1 / h.cpu.cores) * 100) : null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <PageHeader
        kicker="Host Telemetry"
        title="Server Health & Runtime"
        description="Live hardware load, memory footprints, active process stats, and real-time interview pipeline throughput. Auto-refreshes every 30s."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground dark:border-white/[0.08] dark:bg-zinc-900/60">
              {q.isFetching ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
              <span className="font-mono text-[11px]">
                {h ? `Sampled ${new Date(h.sampledAt).toLocaleTimeString()}` : "Connecting…"}
              </span>
            </div>

            <TacticalButton
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} />
              <span>Poll Now</span>
            </TacticalButton>
          </div>
        }
      />

      {q.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-500">
          Telemetry stream error: {q.error.message}
        </div>
      ) : null}

      {/* Main Gauges Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TacticalGauge
          label="CPU Core Load"
          icon={Cpu}
          percent={h?.cpu.percent ?? null}
          detail={h ? `${h.cpu.cores} CPU Cores Online` : ""}
          loading={loading}
        />
        <TacticalGauge
          label="System Load (1m)"
          icon={Activity}
          percent={loadPct}
          detail={
            h
              ? `${h.cpu.load1.toFixed(2)} (1m) · ${h.cpu.load5.toFixed(2)} (5m) · ${h.cpu.load15.toFixed(2)} (15m)`
              : ""
          }
          loading={loading}
        />
        <TacticalGauge
          label="Host Memory (RAM)"
          icon={Zap}
          percent={h?.memory.percent ?? null}
          detail={h ? `${formatBytes(h.memory.used)} / ${formatBytes(h.memory.total)}` : ""}
          loading={loading}
        />
        <TacticalGauge
          label="Root Volume (Disk)"
          icon={HardDrive}
          percent={h?.disk?.percent ?? null}
          detail={h?.disk ? `${formatBytes(h.disk.used)} / ${formatBytes(h.disk.total)}` : "Unavailable"}
          loading={loading}
        />
      </div>

      {/* Process & Container Runtime Panels */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          kicker="Database"
          title="Active Interview Workloads"
          description="Live candidate sessions in state transition."
        >
          {loading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <div className="divide-y divide-border/50 dark:divide-white/[0.05]">
              <MetricRow
                label="Live Sessions (Heartbeat < 2m)"
                value={
                  <span className="flex items-center gap-1.5 font-bold text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    {q.data?.interviews.liveNow ?? 0}
                  </span>
                }
              />
              <MetricRow
                label="Marked In-Progress"
                value={q.data?.interviews.inProgress ?? 0}
              />
              <MetricRow
                label="Reports Pending Generation"
                value={q.data?.interviews.reportsQueued ?? "Up to date"}
              />
            </div>
          )}
        </Panel>

        <Panel
          kicker="Docker Runtime"
          title="Application Container"
          description={h?.inContainer ? "Isolated Docker container process" : "Host process"}
        >
          {loading || !h ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <div className="divide-y divide-border/50 dark:divide-white/[0.05]">
              <MetricRow
                label="Container Memory Limit"
                value={
                  h.container.memoryUsed != null
                    ? `${formatBytes(h.container.memoryUsed)}${h.container.memoryLimit ? ` / ${formatBytes(h.container.memoryLimit)}` : " (unbounded)"}`
                    : "—"
                }
              />
              <MetricRow label="App RSS Memory" value={formatBytes(h.process.rss)} />
              <MetricRow label="App Process Uptime" value={formatUptime(h.uptime.appSeconds)} />
              <MetricRow label="Node.js Engine" value={<span className="font-mono">{h.process.node}</span>} />
            </div>
          )}
        </Panel>

        <Panel
          kicker="Infrastructure"
          title="Host Environment"
          description="Bare-metal / VM host machine telemetry."
        >
          {loading || !h ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <div className="divide-y divide-border/50 dark:divide-white/[0.05]">
              <MetricRow label="Host OS Uptime" value={formatUptime(h.uptime.hostSeconds)} />
              <MetricRow label="Host Architecture" value={<span className="font-mono">{h.platform}</span>} />
              <MetricRow
                label="Hostname"
                value={<span className="font-mono text-primary font-semibold">{h.hostname}</span>}
              />
            </div>
          )}
        </Panel>
      </div>

      {/* Helpful Operational Footer Note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3.5 text-xs text-muted-foreground dark:border-white/[0.06] dark:bg-zinc-950/40">
        <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
        <p className="leading-relaxed">
          CPU, system load, and memory represent total host machine consumption. For dedicated real-time socket connections and relay servers, inspect{" "}
          <Link href="/admin/status" className="font-semibold text-foreground underline hover:text-primary">
            Service Status
          </Link>{" "}
          and{" "}
          <Link href="/admin/server-activity" className="font-semibold text-foreground underline hover:text-primary">
            Server Activity Telemetry
          </Link>.
        </p>
      </div>
    </div>
  );
}
