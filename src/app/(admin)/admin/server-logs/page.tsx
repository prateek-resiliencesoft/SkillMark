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
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

type Source = "all" | "syslog" | "auth" | "kern" | "ufw" | "dpkg";

const RANGES: { label: string; minutes: number }[] = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

const REFRESH_PRESETS: { label: string; ms: number | "custom" }[] = [
  { label: "Off", ms: 0 },
  { label: "1s", ms: 1_000 },
  { label: "5s", ms: 5_000 },
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "Custom", ms: "custom" },
];

const PAGE_SIZES = [25, 50, 100] as const;

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

function clampCustomSeconds(raw: string) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3600, Math.max(1, n));
}

export default function AdminServerLogsPage() {
  const [source, setSource] = useState<Source>("all");
  const [minutes, setMinutes] = useState(60);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput.trim());

  const [refreshPreset, setRefreshPreset] = useState<number | "custom">(5_000);
  const [customSeconds, setCustomSeconds] = useState("10");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50);

  const refreshMs =
    refreshPreset === "custom"
      ? clampCustomSeconds(customSeconds) * 1000
      : refreshPreset;

  const logs = trpc.platform.serverLogs.useQuery(
    {
      source,
      minutes,
      search: deferredSearch || undefined,
      limit: 500,
    },
    {
      staleTime: Math.min(refreshMs || 15_000, 15_000),
      refetchInterval: refreshMs > 0 ? refreshMs : false,
      placeholderData: (prev) => prev,
    },
  );

  const sources = logs.data?.sources ?? [];
  const entries = logs.data?.entries ?? [];

  useEffect(() => {
    setPage(1);
  }, [source, minutes, deferredSearch, pageSize]);

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, safePage, pageSize]);

  const stats = useMemo(
    () => ({
      total: entries.length,
      warn: entries.filter((e) => e.level === "warn").length,
      error: entries.filter((e) => e.level === "error").length,
    }),
    [entries],
  );

  const rangeStart = entries.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, entries.length);

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col gap-3 overflow-hidden lg:h-[calc(100dvh-4rem)]">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Server Logs
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live Linux node logs from Grafana Cloud
            {logs.data?.instance ? (
              <>
                {" "}
                (
                <span className="font-mono text-foreground/80">
                  {logs.data.instance}
                </span>
                )
              </>
            ) : null}
            . Syslog, auth, kernel, firewall.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {logs.data?.grafanaExploreUrl ? (
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <a
                href={logs.data.grafanaExploreUrl}
                target="_blank"
                rel="noreferrer"
              >
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
            <RefreshCw
              className={cn(
                "mr-1.5 h-3.5 w-3.5",
                logs.isFetching && "animate-spin",
              )}
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Auto</span>
          <div className="flex rounded-md border p-0.5">
            {REFRESH_PRESETS.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRefreshPreset(r.ms)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  refreshPreset === r.ms
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {refreshPreset === "custom" ? (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input
                type="number"
                min={1}
                max={3600}
                step={1}
                value={customSeconds}
                onChange={(e) => setCustomSeconds(e.target.value)}
                onBlur={() =>
                  setCustomSeconds(String(clampCustomSeconds(customSeconds)))
                }
                className="h-8 w-20 text-sm"
                aria-label="Custom refresh seconds"
              />
              <span>sec (1–3600)</span>
            </label>
          ) : null}
        </div>

        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Filter while typing…"
          className="h-9 min-w-[200px] flex-1 text-sm"
          aria-label="Search logs"
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-normal">
          {stats.total} lines
        </Badge>
        <Badge
          variant="outline"
          className={cn("font-normal", levelClass("warn"))}
        >
          {stats.warn} warn
        </Badge>
        <Badge
          variant="outline"
          className={cn("font-normal", levelClass("error"))}
        >
          {stats.error} error
        </Badge>
        {refreshMs > 0 ? (
          <Badge variant="outline" className="font-normal">
            every {refreshMs >= 60_000 ? `${refreshMs / 60_000}m` : `${refreshMs / 1000}s`}
          </Badge>
        ) : null}
        {logs.data?.query ? (
          <span className="truncate font-mono text-[10px] opacity-70">
            {logs.data.query}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/40">
        {logs.isLoading ? (
          <div className="space-y-2 overflow-y-auto p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : logs.data?.error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Could not load server logs</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {logs.data.error}
            </p>
          </div>
        ) : !entries.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No log lines in this range</p>
            <p className="text-xs text-muted-foreground">
              Try a wider window or clear the search.
            </p>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto font-mono text-[11px] leading-relaxed sm:text-xs">
            {pageEntries.map((entry, i) => (
              <li
                key={`${entry.timestamp}-${(safePage - 1) * pageSize + i}`}
                className="grid gap-1 px-3 py-2 hover:bg-muted/40 sm:grid-cols-[7.5rem_5.5rem_4.5rem_1fr] sm:items-start sm:gap-3"
              >
                <time className="shrink-0 text-muted-foreground tabular-nums">
                  {formatTs(entry.timestamp)}
                </time>
                <span
                  className="truncate text-muted-foreground"
                  title={entry.filename ?? undefined}
                >
                  {shortFile(entry.filename)}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 w-fit px-1.5 text-[10px] font-normal uppercase",
                    levelClass(entry.level),
                  )}
                >
                  {entry.level}
                </Badge>
                <pre className="whitespace-pre-wrap break-words text-foreground/90">
                  {entry.line.trimEnd()}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            {entries.length
              ? `${rangeStart}–${rangeEnd} of ${entries.length}`
              : "0 lines"}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) =>
              setPageSize(Number(v) as (typeof PAGE_SIZES)[number])
            }
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label="Page size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[4.5rem] text-center tabular-nums">
            {safePage} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
