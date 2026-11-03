"use client";

import { MonitorLatencySparkline } from "@/components/admin/monitor-latency-sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ExternalLink, HeartPulse, RefreshCw } from "lucide-react";

function overallLabel(overall: string) {
  switch (overall) {
    case "operational":
      return "All systems operational";
    case "degraded":
      return "Degraded performance";
    case "down":
      return "Service disruption";
    default:
      return "Status unknown";
  }
}

function overallClass(overall: string) {
  switch (overall) {
    case "operational":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
    case "degraded":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "down":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function statusClass(status: number) {
  switch (status) {
    case 2:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
    case 8:
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case 9:
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case 0:
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
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

export default function UserStatusPage() {
  const status = trpc.status.publicMonitors.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    keepPreviousData: true,
  });

  const data = status.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            System status
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public service checks for Resiliencesoft Interview AI. Internal probes stay in the
            control center.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          <RefreshCw
            className={cn("mr-2 size-3.5", status.isFetching && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      {status.isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : !data?.configured ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <HeartPulse className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Status monitoring is not configured yet.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <Badge
              variant="outline"
              className={cn("font-medium", overallClass(data.overall))}
            >
              {overallLabel(data.overall)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Checked {formatCheckedAt(data.checkedAt)}
              {data.error ? ` · ${data.error}` : ""}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border">
            {data.monitors.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No public monitors are published right now.
              </p>
            ) : (
              <ul className="divide-y">
                {data.monitors.map((m) => (
                  <li
                    key={m.id}
                    className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(9rem,0.9fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {displayName(m.name, m.url)}
                      </p>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="truncate">{m.url}</span>
                        <ExternalLink className="size-3 shrink-0 opacity-60" />
                      </a>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tabular-nums">
                        {m.uptimeRatio != null ? (
                          <span>{m.uptimeRatio.toFixed(2)}% · 30d</span>
                        ) : null}
                        {m.averageResponseMs != null ? (
                          <span>avg {Math.round(m.averageResponseMs)}ms</span>
                        ) : null}
                      </div>
                    </div>
                    <MonitorLatencySparkline
                      points={m.responseTimes}
                      color={sparkColor(m.status)}
                    />
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-fit min-w-[5.5rem] justify-center justify-self-start sm:justify-self-end",
                        statusClass(m.status),
                      )}
                    >
                      {m.statusLabel}
                    </Badge>
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
