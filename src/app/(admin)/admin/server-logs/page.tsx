"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ExternalLink, RefreshCw, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

type Source = "all" | "syslog" | "auth" | "kern" | "ufw" | "dpkg";

const RANGES: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

function levelClass(level: string) {
  switch (level) {
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300";
    case "debug":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function shortFile(path: string | null) {
  if (!path) return "—";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function formatTs(iso: string) {
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

export default function AdminServerLogsPage() {
  const [source, setSource] = useState<Source>("all");
  const [minutes, setMinutes] = useState(60);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const logs = trpc.platform.serverLogs.useQuery(
    {
      source,
      minutes,
      search: search || undefined,
      limit: 150,
    },
    { staleTime: 15_000, refetchInterval: 60_000 },
  );

  const sources = logs.data?.sources ?? [];

  const stats = useMemo(() => {
    const entries = logs.data?.entries ?? [];
    return {
      total: entries.length,
      warn: entries.filter((e) => e.level === "warn").length,
      error: entries.filter((e) => e.level === "error").length,
    };
  }, [logs.data?.entries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Server Logs
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live Linux node logs from Grafana Cloud
            {logs.data?.instance ? (
              <>
                {" "}
                (<span className="font-mono text-foreground/80">{logs.data.instance}</span>)
              </>
            ) : null}
            . Syslog, auth, kernel, firewall.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {logs.data?.grafanaExploreUrl ? (
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <a href={logs.data.grafanaExploreUrl} target="_blank" rel="noreferrer">
                Open in Grafana
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={logs.isFetching}
            onClick={() => void logs.refetch()}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", logs.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
        <Select value={source} onValueChange={(v) => setSource(v as Source)}>
          <SelectTrigger className="w-[180px]" aria-label="Log source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            {(sources.length
              ? sources
              : [
                  { id: "all", label: "All system logs" },
                  { id: "syslog", label: "Syslog" },
                  { id: "auth", label: "Auth" },
                  { id: "kern", label: "Kernel" },
                  { id: "ufw", label: "Firewall (UFW)" },
                  { id: "dpkg", label: "Packages" },
                ]
            ).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex rounded-md border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.minutes}
              type="button"
              onClick={() => setMinutes(r.minutes)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                minutes === r.minutes
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <form
          className="flex min-w-[200px] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Filter text (error, ssh, docker…)"
            className="h-9 text-sm"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            Search
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-normal">
          {stats.total} lines
        </Badge>
        <Badge variant="outline" className={cn("font-normal", levelClass("warn"))}>
          {stats.warn} warn
        </Badge>
        <Badge variant="outline" className={cn("font-normal", levelClass("error"))}>
          {stats.error} error
        </Badge>
        {logs.data?.query ? (
          <span className="font-mono text-[10px] opacity-70">{logs.data.query}</span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card/40">
        {logs.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : logs.data?.error ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Could not load server logs</p>
            <p className="max-w-md text-xs text-muted-foreground">{logs.data.error}</p>
          </div>
        ) : !logs.data?.entries.length ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No log lines in this range</p>
            <p className="text-xs text-muted-foreground">Try a wider window or clear the search.</p>
          </div>
        ) : (
          <ul className="divide-y font-mono text-[11px] leading-relaxed sm:text-xs">
            {logs.data.entries.map((entry, i) => (
              <li
                key={`${entry.timestamp}-${i}`}
                className="grid gap-1 px-3 py-2 hover:bg-muted/40 sm:grid-cols-[7.5rem_5.5rem_4.5rem_1fr] sm:items-start sm:gap-3"
              >
                <time className="shrink-0 text-muted-foreground tabular-nums">
                  {formatTs(entry.timestamp)}
                </time>
                <span className="truncate text-muted-foreground" title={entry.filename ?? undefined}>
                  {shortFile(entry.filename)}
                </span>
                <Badge
                  variant="outline"
                  className={cn("h-5 w-fit px-1.5 text-[10px] font-normal uppercase", levelClass(entry.level))}
                >
                  {entry.level}
                </Badge>
                <pre className="whitespace-pre-wrap break-words text-foreground/90">{entry.line.trimEnd()}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
