"use client";

import { usePollInterval } from "@/components/admin/poll-interval-control";
import {
  PageHeader,
  Panel,
  StatCard,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import type { MetricPoint, ServerMetricKey } from "@/lib/grafana/client";
import { cn } from "@/lib/utils";
import {
  Activity,
  Cpu,
  ExternalLink,
  HardDrive,
  Radio,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const WINDOW_MINUTES = 60;

const pct = (v: number) => `${v.toFixed(1)}%`;
function bytes(v: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Math.abs(v);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
const rate = (v: number) => `${bytes(v)}/s`;

function last(points?: MetricPoint[]): number | null {
  return points && points.length ? points[points.length - 1].v : null;
}
function peak(points?: MetricPoint[]): number | null {
  return points && points.length ? Math.max(...points.map((p) => p.v)) : null;
}

function timeLabel(t: number, minutes: number) {
  const d = new Date(t);
  return minutes > 1440
    ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function MetricChart({
  title,
  points,
  format,
  minutes,
  domain,
  loading,
}: {
  title: string;
  points?: MetricPoint[];
  format: (v: number) => string;
  minutes: number;
  domain?: [number, number | "auto"];
  loading: boolean;
}) {
  const latest = last(points);
  const max = peak(points);
  const id = `grad-${title.replace(/\W/g, "")}`;

  return (
    <Panel
      kicker="Time Series"
      title={title}
      description={
        latest != null
          ? `Current: ${format(latest)}${max != null ? ` · Peak: ${format(max)}` : ""}`
          : "Sampling stream…"
      }
    >
      <div className="h-44 w-full pt-1">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : !points || points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No telemetry recorded in this time range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5941F2" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#5941F2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/40 dark:stroke-white/[0.05]" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => timeLabel(t as number, minutes)}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted-foreground"
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={domain ?? [0, "auto"]}
                tickFormatter={(v) => format(v as number)}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted-foreground"
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255, 255, 255, 0.2)", strokeDasharray: "2 2" }}
                contentStyle={{
                  backgroundColor: "rgba(10, 10, 12, 0.95)",
                  borderColor: "rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "#fff",
                }}
                labelFormatter={(t) => new Date(t as number).toLocaleString()}
                formatter={(v) => [format(Number(v)), title]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="#5941F2"
                strokeWidth={2}
                fill={`url(#${id})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#5941F2" }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

export default function AdminServerActivityPage() {
  const minutes = WINDOW_MINUTES;
  const { ms: refreshMs, control: pollControl } = usePollInterval(30_000);

  const q = trpc.platform.serverActivity.useQuery(
    { minutes },
    {
      refetchInterval: refreshMs || false,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  );

  const data = q.data;
  const s = data?.series ?? {};
  const loading = q.isLoading;

  const capacity = useMemo(() => {
    if (!data) return null;
    const live = data.liveInterviews;
    const cpu = last(s.cpu);
    const mem = last(s.memory);
    if (live < 1 || cpu == null || mem == null) return null;
    const byCpu = Math.floor((live * 80) / Math.max(cpu, 1));
    const byMem = Math.floor((live * 80) / Math.max(mem, 1));
    return { estimate: Math.min(byCpu, byMem), limit: byCpu <= byMem ? "CPU" : "memory" };
  }, [data, s.cpu, s.memory]);

  const charts: {
    key: ServerMetricKey;
    title: string;
    format: (v: number) => string;
    domain?: [number, number | "auto"];
  }[] = [
    { key: "cpu", title: "CPU Utilization", format: pct, domain: [0, 100] },
    { key: "memory", title: "Resident Memory Usage", format: pct, domain: [0, 100] },
    { key: "netIn", title: "Ingress Network Bandwidth", format: rate },
    { key: "netOut", title: "Egress Network Bandwidth", format: rate },
    { key: "disk", title: "Filesystem Disk Usage", format: pct, domain: [0, 100] },
    { key: "load", title: "1-Minute System Load", format: (v) => v.toFixed(2) },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        kicker="Grafana Timeseries"
        title="Server Telemetry & Capacity"
        description="Hardware metrics aggregated from Prometheus & Grafana agent. Use this telemetry to evaluate concurrent candidate headroom."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {pollControl}
            <TacticalButton
              size="sm"
              variant="outline"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={cn("h-3 w-3", q.isFetching && "animate-spin")} />
              <span>Refresh</span>
            </TacticalButton>
            {data?.grafanaUrl ? (
              <TacticalButton asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                <a href={data.grafanaUrl} target="_blank" rel="noreferrer">
                  <span>Open Grafana</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TacticalButton>
            ) : null}
          </div>
        }
      />

      {data?.error ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-medium text-amber-600 dark:text-amber-400">
          Grafana Cloud connection notice: {data.error}
        </div>
      ) : null}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="Live Interviews"
          value={loading ? "…" : String(data?.liveInterviews ?? 0)}
          subtitle="Candidate WebRTC sockets connected"
          icon={Radio}
          accentColor="#10b981"
          loading={loading}
        />
        <StatCard
          title="CPU Core Utilization"
          value={last(s.cpu) != null ? pct(last(s.cpu)!) : "—"}
          subtitle={data?.cpuCores ? `${data.cpuCores} physical cores available` : "Host processor"}
          icon={Cpu}
          accentColor="#5941F2"
          loading={loading}
        />
        <StatCard
          title="System Memory"
          value={last(s.memory) != null ? pct(last(s.memory)!) : "—"}
          subtitle={
            last(s.memoryUsedBytes) != null && data?.memoryTotalBytes
              ? `${bytes(last(s.memoryUsedBytes)!)} of ${bytes(data.memoryTotalBytes)}`
              : "RAM consumption"
          }
          icon={Zap}
          accentColor="#296CF2"
          loading={loading}
        />
        <StatCard
          title="Disk Capacity"
          value={
            data?.diskTotalBytes && data.diskFreeBytes != null
              ? pct(((data.diskTotalBytes - data.diskFreeBytes) / data.diskTotalBytes) * 100)
              : last(s.disk) != null
                ? pct(last(s.disk)!)
                : "—"
          }
          subtitle={
            data?.diskTotalBytes && data.diskFreeBytes != null
              ? `${bytes(data.diskFreeBytes)} free space remaining`
              : "Root mount"
          }
          icon={HardDrive}
          accentColor="#8B5CF6"
          loading={loading}
        />
        <StatCard
          title="Est. Concurrent Limit"
          value={capacity ? `~${capacity.estimate}` : "—"}
          subtitle={capacity ? `Bottleneck: ${capacity.limit} at 80% ceiling` : "Requires ≥1 live session"}
          icon={Activity}
          accentColor="#06B6D4"
          loading={loading}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {charts.map((c) => (
          <MetricChart
            key={c.key}
            title={c.title}
            points={s[c.key]}
            format={c.format}
            domain={c.domain}
            minutes={minutes}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}
