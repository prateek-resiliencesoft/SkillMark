"use client";

import { usePollInterval } from "@/components/admin/poll-interval-control";
import {
  EmptyState,
  PageHeader,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
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
import Link from "next/link";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  RefreshCw,
  ScrollText,
  Search,
  Terminal,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

type Source = "all" | "syslog" | "auth" | "kern" | "ufw" | "dpkg";
type LevelFilter =
  | "all"
  | "problems"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "unknown";

const LEVEL_FILTERS: { id: LevelFilter; label: string }[] = [
  { id: "all", label: "All levels" },
  { id: "problems", label: "Errors & Warnings" },
  { id: "error", label: "Error" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" },
  { id: "unknown", label: "Unknown" },
];

const LOG_WINDOW_MINUTES = 60;
const PAGE_SIZES = [25, 50, 100] as const;

function matchesLevel(level: string, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return level === "error" || level === "warn";
  return level === filter;
}

function levelClass(level: string) {
  switch (level) {
    case "error":
      return "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400 font-bold";
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400 font-bold";
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-500 dark:text-sky-400";
    case "debug":
      return "border-border/60 bg-muted/40 text-muted-foreground";
    default:
      return "border-border/60 bg-muted/20 text-muted-foreground";
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
  const minutes = LOG_WINDOW_MINUTES;
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput.trim());

  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [fileFilter, setFileFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(50);

  const { ms: refreshMs, control: pollControl } = usePollInterval(30_000);

  const logs = trpc.platform.serverLogs.useQuery(
    {
      source,
      minutes,
      search: deferredSearch || undefined,
      limit: 200,
    },
    {
      staleTime: Math.min(refreshMs || 30_000, 30_000),
      refetchInterval: refreshMs > 0 ? refreshMs : false,
      keepPreviousData: true,
    },
  );

  const sources = logs.data?.sources ?? [];
  const rawEntries = useMemo(
    () => logs.data?.entries ?? [],
    [logs.data?.entries],
  );

  const fileOptions = useMemo(() => {
    const names = new Set<string>();
    for (const e of rawEntries) {
      const name = shortFile(e.filename);
      if (name !== "—") names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rawEntries]);

  const entries = useMemo(
    () =>
      rawEntries.filter((e) => {
        if (!matchesLevel(e.level, levelFilter)) return false;
        if (fileFilter !== "all" && shortFile(e.filename) !== fileFilter) {
          return false;
        }
        return true;
      }),
    [rawEntries, levelFilter, fileFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [source, deferredSearch, pageSize, levelFilter, fileFilter]);

  useEffect(() => {
    if (fileFilter !== "all" && !fileOptions.includes(fileFilter)) {
      setFileFilter("all");
    }
  }, [fileFilter, fileOptions]);

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, safePage, pageSize]);

  const stats = useMemo(
    () => ({
      total: rawEntries.length,
      shown: entries.length,
      warn: rawEntries.filter((e) => e.level === "warn").length,
      error: rawEntries.filter((e) => e.level === "error").length,
      info: rawEntries.filter((e) => e.level === "info").length,
    }),
    [rawEntries, entries.length],
  );

  const rangeStart = entries.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, entries.length);

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col gap-3 overflow-hidden lg:h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Host Logging
          </span>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Server Logs & Audits
          </h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Live Linux host journals from Grafana Cloud
            {logs.data?.instance ? (
              <>
                {" "}
                (
                <span className="font-mono text-foreground font-semibold">
                  {logs.data.instance}
                </span>
                )
              </>
            ) : null}
            . Covers syslog, auth daemon, kernel dmesg, and firewall events.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {logs.data?.grafanaExploreUrl ? (
            <TacticalButton asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <a
                href={logs.data.grafanaExploreUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>Grafana Explore</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </TacticalButton>
          ) : null}

          <TacticalButton
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={logs.isFetching}
            onClick={() => void logs.refetch()}
          >
            <RefreshCw
              className={cn("h-3 w-3", logs.isFetching && "animate-spin text-primary")}
            />
            <span>Refresh</span>
          </TacticalButton>
        </div>
      </div>

      {/* Filter Control Bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
        <Select value={source} onValueChange={(v) => setSource(v as Source)}>
          <SelectTrigger className="h-8 w-[160px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900" aria-label="Log source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent className="text-xs">
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

        <Select
          value={levelFilter}
          onValueChange={(v) => setLevelFilter(v as LevelFilter)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900" aria-label="Log level">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            {LEVEL_FILTERS.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fileFilter} onValueChange={setFileFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900" aria-label="Log file">
            <SelectValue placeholder="File" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All files</SelectItem>
            {fileOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {pollControl}

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Regex / text filter in log stream…"
            className="h-8 pl-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900 font-mono"
            aria-label="Search logs"
          />
        </div>
      </div>

      {/* Log Stats Pills */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-foreground font-medium">
          {levelFilter === "all" && fileFilter === "all"
            ? `${stats.total} lines`
            : `${stats.shown} shown / ${stats.total}`}
        </span>

        <button
          type="button"
          onClick={() =>
            setLevelFilter((v) => (v === "error" ? "all" : "error"))
          }
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-95",
            levelFilter === "error"
              ? "border-rose-500 bg-rose-500 text-white"
              : "border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20",
          )}
        >
          {stats.error} error
        </button>

        <button
          type="button"
          onClick={() =>
            setLevelFilter((v) => (v === "warn" ? "all" : "warn"))
          }
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-95",
            levelFilter === "warn"
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20",
          )}
        >
          {stats.warn} warn
        </button>

        <button
          type="button"
          onClick={() =>
            setLevelFilter((v) => (v === "info" ? "all" : "info"))
          }
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all active:scale-95",
            levelFilter === "info"
              ? "border-sky-500 bg-sky-500 text-white"
              : "border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20",
          )}
        >
          {stats.info} info
        </button>

        <button
          type="button"
          onClick={() =>
            setLevelFilter((v) => (v === "problems" ? "all" : "problems"))
          }
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all active:scale-95",
            levelFilter === "problems"
              ? "border-foreground bg-foreground text-background"
              : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground",
          )}
        >
          problems only
        </button>

        {refreshMs > 0 ? (
          <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
            polling {refreshMs >= 60_000 ? `${refreshMs / 60_000}m` : `${refreshMs / 1000}s`}
          </span>
        ) : null}
      </div>

      {/* Terminal Viewport */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/90">
        {logs.isLoading ? (
          <div className="space-y-2.5 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded" />
            ))}
          </div>
        ) : logs.data?.error ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-1 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Grafana Loki stream currently unreachable
              </p>
              <p className="break-words font-mono text-[11px] text-muted-foreground">
                {logs.data.error}
              </p>
              <p className="text-[11px] text-muted-foreground">
                App errors are recorded in the database. See them grouped by organization and candidate on the{" "}
                <Link href="/admin/error-logs" className="font-medium text-primary underline underline-offset-2">
                  Error Logs
                </Link>{" "}
                page.
              </p>
            </div>
          </div>
        ) : !entries.length ? (
          <EmptyState
            icon={Terminal}
            title={rawEntries.length ? "No logs match current filters" : "No log events recorded"}
            description={
              rawEntries.length
                ? "Try adjusting your level or regex search parameters."
                : "No journal events observed in the lookback window."
            }
          />
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto font-mono text-[11px] leading-relaxed dark:divide-white/[0.03] custom-scrollbar">
            {pageEntries.map((entry, i) => (
              <li
                key={`${entry.timestamp}-${(safePage - 1) * pageSize + i}`}
                className="grid gap-1 px-3 py-1.5 transition-colors hover:bg-muted/40 dark:hover:bg-zinc-900/50 sm:grid-cols-[7.5rem_6rem_4.5rem_1fr] sm:items-start sm:gap-2.5"
              >
                <time className="shrink-0 text-muted-foreground/80 tabular-nums text-[10px]">
                  {formatTs(entry.timestamp)}
                </time>
                <span
                  className="truncate text-muted-foreground/90 font-medium text-[11px]"
                  title={entry.filename ?? undefined}
                >
                  {shortFile(entry.filename)}
                </span>
                <span
                  className={cn(
                    "inline-flex w-fit items-center rounded px-1.5 py-0.2 text-[9px] uppercase tracking-wide font-bold",
                    levelClass(entry.level),
                  )}
                >
                  {entry.level}
                </span>
                <pre className="whitespace-pre-wrap break-words text-foreground/90 font-mono text-[11px] selection:bg-primary selection:text-white">
                  {entry.line.trimEnd()}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs text-muted-foreground dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px]">
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
            <SelectTrigger className="h-7 w-[105px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900" aria-label="Page size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs">
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <TacticalButton
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </TacticalButton>
          <span className="min-w-[4rem] text-center font-mono text-xs tabular-nums">
            {safePage} / {pageCount}
          </span>
          <TacticalButton
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </TacticalButton>
        </div>
      </div>
    </div>
  );
}
