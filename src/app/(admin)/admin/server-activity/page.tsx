"use client";

import { usePollInterval } from "@/components/admin/poll-interval-control";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import type { MetricPoint, ServerMetricKey } from "@/lib/grafana/client";
import { cn } from "@/lib/utils";
import { ExternalLink, RefreshCw } from "lucide-react";
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

/** Fixed look-back window; the polling control decides how fresh it is. */
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** One measure per chart (never dual-axis). */
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
    <section className="rounded-xl border p-4" aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {latest != null ? `now ${format(latest)}` : "—"}
          {max != null ? ` · peak ${format(max)}` : ""}
        </p>
      </div>
      <div className="mt-3 h-44">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : !points || points.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No data for this range.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => timeLabel(t as number, minutes)}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={domain ?? [0, "auto"]}
                tickFormatter={(v) => format(v as number)}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                labelFormatter={(t) => new Date(t as number).toLocaleString()}
                formatter={(v) => [format(Number(v)), title]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill={`url(#${id})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--background))" }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
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
    // Rough: scale current load linearly to an 80% ceiling. Includes OS/base load, so it is conservative.
    const byCpu = Math.floor((live * 80) / Math.max(cpu, 1));
    const byMem = Math.floor((live * 80) / Math.max(mem, 1));
    return { estimate: Math.min(byCpu, byMem), limit: byCpu <= byMem ? "CPU" : "memory" };
  }, [data, s.cpu, s.memory]);

  const charts: { key: ServerMetricKey; title: string; format: (v: number) => string; domain?: [number, number | "auto"] }[] = [
    { key: "cpu", title: "CPU usage", format: pct, domain: [0, 100] },
    { key: "memory", title: "Memory usage", format: pct, domain: [0, 100] },
    { key: "netIn", title: "Bandwidth in", format: rate },
    { key: "netOut", title: "Bandwidth out", format: rate },
    { key: "disk", title: "Disk usage", format: pct, domain: [0, 100] },
    { key: "load", title: "Load average (1m)", format: (v) => v.toFixed(2) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Server activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CPU, memory and bandwidth from Grafana — use it to see how many interviews the server can run at once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pollControl}
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />
            Refresh
          </Button>
          {data?.grafanaUrl ? (
            <Button asChild size="sm" variant="ghost">
              <a href={data.grafanaUrl} target="_blank" rel="noreferrer">
                Grafana <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {data?.error ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {data.error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Live interviews"
          value={loading ? "…" : String(data?.liveInterviews ?? 0)}
          hint="Started, candidate tab connected"
        />
        <Stat label="CPU" value={last(s.cpu) != null ? pct(last(s.cpu)!) : "—"} hint={data?.cpuCores ? `${data.cpuCores} cores` : undefined} />
        <Stat
          label="Memory"
          value={last(s.memory) != null ? pct(last(s.memory)!) : "—"}
          hint={
            last(s.memoryUsedBytes) != null && data?.memoryTotalBytes
              ? `${bytes(last(s.memoryUsedBytes)!)} of ${bytes(data.memoryTotalBytes)}`
              : undefined
          }
        />
        <Stat
          label="Est. concurrent capacity"
          value={capacity ? `~${capacity.estimate}` : "—"}
          hint={capacity ? `Limited by ${capacity.limit} · rough, at 80% load` : "Needs ≥1 live interview"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
