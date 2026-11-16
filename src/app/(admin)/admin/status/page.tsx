"use client";

import { MonitorLatencySparkline } from "@/components/admin/monitor-latency-sparkline";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatusPill,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  HeartPulse,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

function overallLabel(overall: string) {
  switch (overall) {
    case "operational":
      return "All Systems Operational";
    case "degraded":
      return "Degraded Performance";
    case "down":
      return "Service Outage Detected";
    default:
      return "Status Nominal";
  }
}

function overallClass(overall: string) {
  switch (overall) {
    case "operational":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "degraded":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "down":
      return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
}

function statusClass(status: number) {
  switch (status) {
    case 2:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case 8:
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case 9:
      return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
}

function sparkColor(status: number) {
  switch (status) {
    case 2:
      return "rgb(16 185 129)";
    case 8:
      return "rgb(245 158 11)";
    case 9:
      return "rgb(239 68 68)";
    default:
      return "hsl(var(--muted-foreground))";
  }
}

function formatCheckedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function displayName(name: string, url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return path ? `${u.hostname}${path}` : u.hostname;
  } catch {
    return name;
  }
}

export default function AdminStatusPage() {
  const utils = trpc.useUtils();
  const status = trpc.platform.statusMonitors.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    keepPreviousData: true,
  });

  const createMonitor = trpc.platform.createStatusMonitor.useMutation({
    onSuccess: async () => {
      await utils.platform.statusMonitors.invalidate();
      setUrl("");
      setName("");
      setFormError(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const setPublic = trpc.platform.setStatusMonitorPublic.useMutation({
    onSuccess: async () => {
      await utils.platform.statusMonitors.invalidate();
    },
  });

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const data = status.data;

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMonitor.mutate({
      url: url.trim(),
      friendlyName: name.trim() || undefined,
      intervalSeconds: 300,
      isPublic,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker="External Probing"
        title="Uptime & Service Health"
        description="Configure automated synthetic HTTP probes and decide what endpoints show on the public status indicator."
        actions={
          <TacticalButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
            className="h-8 text-xs gap-1.5"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", status.isFetching && "animate-spin")}
            />
            <span>Refresh</span>
          </TacticalButton>
        }
      />

      {/* Add Monitor Panel */}
      <Panel
        kicker="Prober Configuration"
        title="Add Synthetic URL Check"
        description="Monitor an endpoint from global nodes with 300s automated intervals."
      >
        <form onSubmit={onCreate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="monitor-url" className="text-xs font-medium text-foreground">
                Target Endpoint URL
              </Label>
              <Input
                id="monitor-url"
                type="url"
                required
                placeholder="https://app.resiliencesoftinterview.com/login"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-9 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monitor-name" className="text-xs font-medium text-foreground">
                Friendly Label (Optional)
              </Label>
              <Input
                id="monitor-name"
                placeholder="e.g. Auth Gateway"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80"
              />
            </div>
            <div className="flex items-end">
              <TacticalButton
                type="submit"
                loading={createMonitor.isPending}
                disabled={createMonitor.isPending || !url.trim()}
                className="h-9 w-full sm:w-auto text-xs gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Endpoint</span>
              </TacticalButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Switch
              id="monitor-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
            <Label
              htmlFor="monitor-public"
              className="cursor-pointer text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              Expose on public status widget and marketing landing page
            </Label>
          </div>

          {formError ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      </Panel>

      {/* Monitors List / Telemetry */}
      {status.isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>
      ) : !data?.configured ? (
        <EmptyState
          icon={HeartPulse}
          title="Uptime monitoring service unconfigured"
          description="Configure UPTIMEROBOT_API_KEY environment variable on the server to automatically ingest live external ping telemetry."
        />
      ) : (
        <>
          {/* Status Headline Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase",
                  overallClass(data.overall),
                )}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {overallLabel(data.overall)}
              </span>

              <span className="text-xs text-muted-foreground font-mono">
                Sampled {formatCheckedAt(data.checkedAt)}
                {data.error ? ` · ${data.error}` : ""}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span>
                {data.monitors.length} Total Probes ·{" "}
                <span className="font-semibold text-foreground">
                  {data.monitors.filter((m) => m.isPublic).length} Public
                </span>
              </span>
            </div>
          </div>

          {/* Monitors Grid */}
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50 dark:backdrop-blur-md">
            {data.monitors.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No probes configured yet"
                description="Add an endpoint URL above to begin recording latency sparklines and uptime percentage."
              />
            ) : (
              <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
                {data.monitors.map((m) => (
                  <li
                    key={m.id}
                    className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(10rem,1fr)_auto_auto] lg:items-center transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-heading text-sm font-semibold text-foreground">
                          {displayName(m.name, m.url)}
                        </p>
                        {m.isPublic ? (
                          <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary uppercase">
                            Public
                          </span>
                        ) : (
                          <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground uppercase">
                            Internal
                          </span>
                        )}
                      </div>

                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground font-mono transition-colors"
                      >
                        <span className="truncate">{m.url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      </a>

                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground font-mono">
                        {m.uptimeRatio != null ? (
                          <span className="tabular-nums font-semibold text-emerald-500">
                            {m.uptimeRatio.toFixed(3)}% uptime (30d)
                          </span>
                        ) : null}
                        {m.averageResponseMs != null ? (
                          <span className="tabular-nums">
                            avg {Math.round(m.averageResponseMs)}ms latency
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <MonitorLatencySparkline
                      points={m.responseTimes}
                      color={sparkColor(m.status)}
                    />

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`pub-${m.id}`}
                        checked={m.isPublic}
                        disabled={
                          setPublic.isPending &&
                          setPublic.variables?.id === m.id
                        }
                        onCheckedChange={(checked) => {
                          setPublic.mutate({ id: m.id, isPublic: checked });
                        }}
                      />
                      <Label
                        htmlFor={`pub-${m.id}`}
                        className="cursor-pointer text-xs font-medium text-muted-foreground"
                      >
                        Public Display
                      </Label>
                    </div>

                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase",
                        statusClass(m.status),
                      )}
                    >
                      {m.statusLabel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
