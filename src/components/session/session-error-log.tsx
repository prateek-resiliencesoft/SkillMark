"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_LABELS,
  errorLogToCsv,
  type ErrorCategory,
  type ErrorLogSummary,
  type ErrorSeverity,
  type SessionErrorEntry,
} from "@/lib/session-error-log";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Bug, CheckCircle2, FileDown } from "lucide-react";
import { useState } from "react";

const SEVERITY_STYLES: Record<ErrorSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
  critical: "bg-red-600 text-white dark:bg-red-700",
};

const IMPACT_STYLES: Record<string, string> = {
  none: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  low: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300",
  medium: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  high: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
};

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Error Log" button + dialog next to the session report (org members only). */
export function SessionErrorLogButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const q = trpc.session.getErrorLog.useQuery({ sessionId }, { retry: false });
  if (q.isError) return null; // not a member / no access
  const total = q.data?.summary.total ?? 0;
  const hasSerious = (q.data?.summary.bySeverity.error ?? 0) + (q.data?.summary.bySeverity.critical ?? 0) > 0;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={q.isLoading}>
        <Bug className="mr-2 h-4 w-4" />
        Error Log
        {total > 0 && (
          <Badge variant={hasSerious ? "destructive" : "secondary"} className="ml-2 px-1.5 text-xs">
            {total}
          </Badge>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-4 w-4" /> Error Log Report
            </DialogTitle>
            <DialogDescription>
              Errors, API rate limits and voice disconnects recorded during this interview. API keys are never logged —
              only whether the organization key or the default key was used.
            </DialogDescription>
          </DialogHeader>
          {q.isLoading || !q.data ? <Skeleton className="h-64" /> : <ErrorLogReport sessionId={sessionId} entries={q.data.entries} summary={q.data.summary} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Summary = ErrorLogSummary;

export function ErrorLogReport({ sessionId, entries, summary }: { sessionId: string; entries: SessionErrorEntry[]; summary: Summary }) {
  if (summary.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="font-medium">No errors recorded</p>
        <p className="text-sm text-muted-foreground">This interview ran without API, voice or browser errors.</p>
      </div>
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => download(`error-log-${sessionId.slice(0, 8)}-${stamp}.csv`, "text/csv", errorLogToCsv(entries))}>
          <FileDown className="mr-2 h-4 w-4" /> CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => download(`error-log-${sessionId.slice(0, 8)}-${stamp}.json`, "application/json", JSON.stringify({ sessionId, summary, entries }, null, 2))}
        >
          <FileDown className="mr-2 h-4 w-4" /> JSON
        </Button>
      </div>

      <div className={cn("rounded-lg border px-4 py-3 text-sm", IMPACT_STYLES[summary.impact])}>
        <span className="font-semibold capitalize">Impact: {summary.impact}.</span> {summary.impactNote}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total events" value={summary.total} />
        <Stat label="Rate-limit hits (429)" value={summary.rateLimitHits} />
        <Stat label="Key failovers" value={summary.failovers} />
        <Stat label="Default-key events" value={summary.envKeyUsed} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(Object.entries(summary.byCategory) as [ErrorCategory, number][]).map(([cat, n]) => (
            <div key={cat} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <span>{CATEGORY_LABELS[cat] ?? cat}</span>
              <Badge variant="secondary" className="text-xs">{n}</Badge>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            First: {fmt(summary.firstAt)} · Last: {fmt(summary.lastAt)}
          </p>
        </CardContent>
      </Card>

      <div>
        <p className="mb-2 text-sm font-medium">Timeline</p>
        <ScrollArea className="h-72 rounded-md border">
          <ol className="divide-y">
            {entries.map((e, i) => {
              const ctx = (e.context ?? {}) as Record<string, unknown>;
              const meta = [
                e.status ? `HTTP ${e.status}` : null,
                e.code,
                ctx.keySource ? `${ctx.keySource === "org" ? "org key" : "default key"}${ctx.keySlot ? ` #${ctx.keySlot}` : ""}` : null,
                ctx.failover ? "failed over" : null,
                typeof ctx.stage === "string" ? ctx.stage : null,
                typeof ctx.recoveredBy === "string" ? `recovered by ${ctx.recoveredBy}` : null,
              ].filter(Boolean);
              return (
                <li key={e.id ?? i} className="space-y-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : ""}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium uppercase", SEVERITY_STYLES[e.severity] ?? SEVERITY_STYLES.error)}>{e.severity}</span>
                    <Badge variant="outline" className="text-[11px] font-normal">{CATEGORY_LABELS[e.category] ?? e.category}</Badge>
                    <span className="text-xs text-muted-foreground">{e.source}</span>
                  </div>
                  <p className="break-words">{e.message}</p>
                  {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>}
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
