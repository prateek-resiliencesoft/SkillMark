"use client";

import {
  Meter,
  PageHeader,
  Panel,
  formatBytes,
  formatUptime,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { levelFor, type Level } from "@/lib/admin-stats";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";

const LEVEL_TEXT: Record<Level, string> = { ok: "Normal", warn: "High", critical: "Very high" };

function Gauge({
  label,
  percent,
  detail,
  loading,
}: {
  label: string;
  percent: number | null;
  detail: string;
  loading: boolean;
}) {
  const level = levelFor(percent);
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {!loading && percent != null ? (
          <span
            className={cn(
              "text-[11px] font-medium",
              level === "critical" ? "text-red-600" : level === "warn" ? "text-amber-600" : "text-green-600",
            )}
          >
            {LEVEL_TEXT[level]}
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="font-heading text-3xl font-bold tabular-nums">
          {percent == null ? "—" : `${percent.toFixed(0)}%`}
        </p>
      )}
      <Meter percent={loading ? 0 : percent} tone={level} />
      <p className="text-xs text-muted-foreground">{loading ? "Reading…" : detail}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function ServerHealthPage() {
  const q = trpc.platformOps.hostHealth.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const h = q.data?.host;
  const loading = q.isLoading;
  const loadPct = h ? Math.min(100, (h.cpu.load1 / h.cpu.cores) * 100) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Server health"
        description="Live readings from the server running this app. Updates every 10 seconds."
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-green-500" />}
              {h ? `Read at ${new Date(h.sampledAt).toLocaleTimeString()}` : "Loading"}
            </span>
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      {q.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not read server health: {q.error.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Gauge
          label="CPU"
          percent={h?.cpu.percent ?? null}
          detail={h ? `${h.cpu.cores} cores` : ""}
          loading={loading}
        />
        <Gauge
          label="Load (1 min)"
          percent={loadPct}
          detail={h ? `${h.cpu.load1.toFixed(2)} / ${h.cpu.load5.toFixed(2)} / ${h.cpu.load15.toFixed(2)} (1, 5, 15 min)` : ""}
          loading={loading}
        />
        <Gauge
          label="Memory"
          percent={h?.memory.percent ?? null}
          detail={h ? `${formatBytes(h.memory.used)} of ${formatBytes(h.memory.total)}` : ""}
          loading={loading}
        />
        <Gauge
          label="Disk (/)"
          percent={h?.disk?.percent ?? null}
          detail={h?.disk ? `${formatBytes(h.disk.used)} of ${formatBytes(h.disk.total)}` : "Not readable"}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Interviews right now" description="From the database">
          {loading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="divide-y">
              <Row label="Live (heartbeat in last 2 min)" value={q.data?.interviews.liveNow ?? 0} />
              <Row label="Marked in progress" value={q.data?.interviews.inProgress ?? 0} />
              <Row
                label="Reports waiting or generating"
                value={q.data?.interviews.reportsQueued ?? "Needs migration 28"}
              />
            </div>
          )}
        </Panel>

        <Panel title="App container" description={h?.inContainer ? "Running in Docker" : "Running directly on the host"}>
          {loading || !h ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="divide-y">
              <Row
                label="Container memory"
                value={
                  h.container.memoryUsed != null
                    ? `${formatBytes(h.container.memoryUsed)}${h.container.memoryLimit ? ` of ${formatBytes(h.container.memoryLimit)}` : " (no limit)"}`
                    : "—"
                }
              />
              <Row label="App process memory" value={formatBytes(h.process.rss)} />
              <Row label="App uptime" value={formatUptime(h.uptime.appSeconds)} />
              <Row label="Node" value={h.process.node} />
            </div>
          )}
        </Panel>

        <Panel title="Server" description="Host the container runs on">
          {loading || !h ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="divide-y">
              <Row label="Server uptime" value={formatUptime(h.uptime.hostSeconds)} />
              <Row label="Hostname" value={<span className="font-mono text-xs">{h.hostname}</span>} />
              <Row label="Kernel" value={<span className="text-xs">{h.platform}</span>} />
            </div>
          )}
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        CPU, load and memory are for the whole server. Disk is the app container&apos;s root filesystem.
        Other containers (database, voice relay) are not visible from here; see{" "}
        <Link href="/admin/status" className="underline">Status</Link> for uptime checks and{" "}
        <Link href="/admin/server-activity" className="underline">Server Activity</Link> for history from Grafana.
      </p>
    </div>
  );
}
