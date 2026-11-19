"use client";

import { ErrorEventsTable } from "@/components/admin/error-logs/error-events-table";
import { ErrorGroupsTable } from "@/components/admin/error-logs/error-groups-table";
import { ErrorSeriesChart } from "@/components/admin/error-logs/error-series-chart";
import { FilterBar, PageHeader, Panel, StatCard } from "@/components/admin/admin-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MAX_REPORT_RANGE_MS, type GroupStatus } from "@/lib/error-log-report";
import { CATEGORY_LABELS, ERROR_CATEGORIES, ERROR_SEVERITIES, type ErrorCategory, type ErrorSeverity } from "@/lib/session-error-log";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Building2, Layers, Users, Zap } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

const PRESETS = {
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  custom: { label: "Custom dates", ms: 0 },
} as const;
type Preset = keyof typeof PRESETS;

const TRIGGER = "h-9 w-[150px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80";
const PAGE_SIZE = 50;

/** Local YYYY-MM-DD for <input type="date">, n days before today. */
function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AdminErrorLogsPage() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState(() => isoDay(-6));
  const [customTo, setCustomTo] = useState(() => isoDay(0));
  const [category, setCategory] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [org, setOrg] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());
  const [page, setPage] = useState(0);

  // Range is computed when the preset or custom dates change, not on every render,
  // so the query key stays stable between renders.
  const range = useMemo(() => {
    if (preset !== "custom") {
      const to = new Date();
      return { from: new Date(to.getTime() - PRESETS[preset].ms).toISOString(), to: to.toISOString(), error: null as string | null };
    }
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T00:00:00`);
    to.setDate(to.getDate() + 1); // include the whole end day
    if (!(to.getTime() > from.getTime())) return { from: null, to: null, error: "End date must be on or after start date." };
    if (to.getTime() - from.getTime() > MAX_REPORT_RANGE_MS) return { from: null, to: null, error: "Range can be at most 31 days." };
    return { from: from.toISOString(), to: to.toISOString(), error: null };
  }, [preset, customFrom, customTo]);

  const input = useMemo(
    () =>
      range.from && range.to
        ? {
            from: range.from,
            to: range.to,
            category: category === "all" ? undefined : (category as ErrorCategory),
            severity: severity === "all" ? undefined : (severity as ErrorSeverity),
            organizationId: org === "all" ? undefined : org,
            status: status === "all" ? undefined : (status as GroupStatus),
            search: search || undefined,
            page,
            pageSize: PAGE_SIZE,
          }
        : null,
    [range.from, range.to, category, severity, org, status, search, page],
  );

  const q = trpc.errorLogs.report.useQuery(input!, { enabled: !!input, staleTime: 15_000, keepPreviousData: true });
  const data = q.data;
  const summary = data?.summary;

  const changed = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Telemetry"
        title="Error Logs"
        description="Interview errors across all organizations, grouped by error. Start with the top rows."
      />

      <FilterBar query={searchInput} onQueryChange={(v) => changed(() => setSearchInput(v))} placeholder="Search message, candidate, org…">
        <Select value={preset} onValueChange={(v) => changed(() => setPreset(v as Preset))}>
          <SelectTrigger className={TRIGGER} aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            {(Object.keys(PRESETS) as Preset[]).map((k) => (
              <SelectItem key={k} value={k}>
                {PRESETS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === "custom" && (
          <>
            <input
              type="date"
              aria-label="From date"
              value={customFrom}
              onChange={(e) => changed(() => setCustomFrom(e.target.value))}
              className="h-9 rounded-lg border border-border/70 bg-background/80 px-2 text-xs dark:border-white/[0.08] dark:bg-zinc-900/80"
            />
            <input
              type="date"
              aria-label="To date"
              value={customTo}
              onChange={(e) => changed(() => setCustomTo(e.target.value))}
              className="h-9 rounded-lg border border-border/70 bg-background/80 px-2 text-xs dark:border-white/[0.08] dark:bg-zinc-900/80"
            />
          </>
        )}
        <Select value={org} onValueChange={(v) => changed(() => setOrg(v))}>
          <SelectTrigger className={TRIGGER} aria-label="Organization">
            <SelectValue placeholder="Organization" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All organizations</SelectItem>
            {(data?.organizations ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => changed(() => setCategory(v))}>
          <SelectTrigger className={TRIGGER} aria-label="Category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All categories</SelectItem>
            {ERROR_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={(v) => changed(() => setSeverity(v))}>
          <SelectTrigger className={TRIGGER} aria-label="Severity">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All severities</SelectItem>
            {ERROR_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => changed(() => setStatus(v))}>
          <SelectTrigger className={TRIGGER} aria-label="Group status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {range.error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600">{range.error}</p>
      ) : null}
      {q.error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          Could not load error logs: {q.error.message}
        </p>
      ) : null}
      {data?.truncated ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600">
          This range has more events than the page can load. Showing the newest-first slice up to the limit; narrow the dates for full counts.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Error events" value={summary?.total} icon={Zap} loading={q.isLoading} subtitle="In selected range" />
        <StatCard title="Error groups" value={summary?.groups} icon={Layers} loading={q.isLoading} subtitle={`${summary?.openGroups ?? 0} still open`} />
        <StatCard title="Orgs affected" value={summary?.orgs} icon={Building2} loading={q.isLoading} />
        <StatCard title="Candidates affected" value={summary?.candidates} icon={Users} loading={q.isLoading} />
      </div>

      <Panel
        title="Errors over time"
        description={data ? `Counted per ${data.range.bucket === "hour" ? "hour" : "day"}, colored by category.` : undefined}
      >
        {q.isLoading || !data ? <Skeleton className="h-56 w-full" /> : <ErrorSeriesChart series={data.series} bucket={data.range.bucket} />}
      </Panel>

      <Panel title="Error groups" description="Ranked by how often each error happened. Click a row to see which orgs and candidates it hit, and to set its status.">
        {q.isLoading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <ErrorGroupsTable groups={data.groups} />
        )}
      </Panel>

      <Panel title="All events" description="Newest first. Each row is one error that happened during an interview.">
        {q.isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ErrorEventsTable events={data.events} loading={q.isFetching} onPage={setPage} />
        )}
      </Panel>

      {!q.isLoading && !data && !range.error ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Choose a valid range to load errors.
        </p>
      ) : null}
    </div>
  );
}
