"use client";

import { MonitorLatencySparkline } from "@/components/admin/monitor-latency-sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ExternalLink, HeartPulse, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Status
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add checkbot URLs, choose what is public on the landing page and
            in-app status.
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

      <form
        onSubmit={onCreate}
        className="space-y-4 rounded-xl border p-4 sm:p-5"
      >
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Add checkbot URL</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="monitor-url">URL</Label>
            <Input
              id="monitor-url"
              type="url"
              required
              placeholder="https://app.resiliencesoftinterview.com/login"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="monitor-name">Name (optional)</Label>
            <Input
              id="monitor-name"
              placeholder="Login page"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={createMonitor.isLoading || !url.trim()}
              className="w-full sm:w-auto"
            >
              {createMonitor.isLoading ? "Adding…" : "Add monitor"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="monitor-public"
            checked={isPublic}
            onCheckedChange={setIsPublic}
          />
          <Label htmlFor="monitor-public" className="cursor-pointer font-normal">
            Show on landing page + user status
          </Label>
        </div>
        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </form>

      {status.isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : !data?.configured ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <HeartPulse className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Set <code className="text-foreground">UPTIMEROBOT_API_KEY</code> on
            the server to load monitors.
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
            <span className="text-xs text-muted-foreground">
              {data.monitors.length} monitors ·{" "}
              {data.monitors.filter((m) => m.isPublic).length} public
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border">
            {data.monitors.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No monitors yet. Add a checkbot URL above.
              </p>
            ) : (
              <ul className="divide-y">
                {data.monitors.map((m) => (
                  <li
                    key={m.id}
                    className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(9rem,0.8fr)_auto_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {displayName(m.name, m.url)}
                        </p>
                        {m.isPublic ? (
                          <Badge variant="outline" className="text-[10px]">
                            Public
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Internal
                          </Badge>
                        )}
                      </div>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="truncate">{m.url}</span>
                        <ExternalLink className="size-3 shrink-0 opacity-60" />
                      </a>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {m.uptimeRatio != null ? (
                          <span className="tabular-nums">
                            {m.uptimeRatio.toFixed(3)}% · 30d
                          </span>
                        ) : null}
                        {m.averageResponseMs != null ? (
                          <span className="tabular-nums">
                            avg {Math.round(m.averageResponseMs)}ms
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
                          setPublic.isLoading &&
                          setPublic.variables?.id === m.id
                        }
                        onCheckedChange={(checked) => {
                          setPublic.mutate({ id: m.id, isPublic: checked });
                        }}
                      />
                      <Label
                        htmlFor={`pub-${m.id}`}
                        className="cursor-pointer text-xs font-normal text-muted-foreground"
                      >
                        Landing / app
                      </Label>
                    </div>

                    <Badge
                      variant="outline"
                      className={cn(
                        "h-fit min-w-[5.5rem] justify-center justify-self-start lg:justify-self-end",
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
