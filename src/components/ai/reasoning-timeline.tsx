"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FLOW_LABELS, type AiFlow, type AiRunView, type ReasoningStep } from "@/lib/ai/graph/types";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Brain, Check, ChevronDown, ChevronRight, CircleSlash, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";

function fmtMs(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function StatusIcon({ status }: { status: ReasoningStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === "error") return <X className="h-3.5 w-3.5 text-destructive" />;
  return <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" />;
}

function StepRow({ step, last }: { step: ReasoningStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = [fmtMs(step.ms), step.tokens ? `${step.tokens.toLocaleString()} tok` : ""].filter(Boolean).join(" · ");
  return (
    <li className="relative flex gap-3 pb-3">
      {!last && <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" aria-hidden />}
      <span className="z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background">
        <StatusIcon status={step.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("text-sm font-medium", step.status === "skipped" && "text-muted-foreground")}>{step.label}</span>
          {meta && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{meta}</span>}
        </div>
        {step.detail && (
          <p className={cn("mt-0.5 text-xs", step.status === "error" ? "text-destructive" : "text-muted-foreground")}>{step.detail}</p>
        )}
        {step.thinking && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Brain className="h-3 w-3" /> {open ? "Hide reasoning" : "Show reasoning"}
            </button>
            {open && (
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-sans text-xs leading-relaxed text-muted-foreground">
                {step.thinking}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Live or historical timeline of what an AI flow did, step by step. */
export function ReasoningTimeline({
  steps,
  title = "How the AI got here",
  traceUrl,
  className,
  collapsible = false,
  defaultOpen = true,
}: {
  steps: ReasoningStep[];
  title?: string;
  traceUrl?: string | null;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!steps.length) return null;
  const running = steps.some((s) => s.status === "running");
  const tokens = steps.reduce((n, s) => n + (s.tokens ?? 0), 0);
  const ms = steps.reduce((n, s) => n + (s.ms ?? 0), 0);
  return (
    <div className={cn("rounded-lg border bg-card/50 p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground disabled:cursor-default"
        >
          {collapsible && (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
          <Brain className="h-3.5 w-3.5" />
          <span className="truncate">{title}</span>
          {running && <Loader2 className="h-3 w-3 animate-spin" />}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {!running && <span className="tabular-nums">{[fmtMs(ms), tokens ? `${tokens.toLocaleString()} tok` : ""].filter(Boolean).join(" · ")}</span>}
          {traceUrl && (
            <a href={traceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Langfuse <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      {open && (
        <ol className="mt-3">
          {steps.map((s, i) => (
            <StepRow key={s.id} step={s} last={i === steps.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunCard({ run, defaultOpen }: { run: AiRunView; defaultOpen: boolean }) {
  return (
    <ReasoningTimeline
      steps={run.steps}
      traceUrl={run.traceUrl}
      collapsible
      defaultOpen={defaultOpen}
      title={`${FLOW_LABELS[run.flow] ?? run.flow} · ${new Date(run.startedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}${run.status === "error" ? " · failed" : ""}`}
    />
  );
}

/** Saved reasoning runs for a round 2 or round 1 session. */
export function AiRunHistory({
  subjectType,
  subjectId,
  flows,
  limit = 5,
  emptyText,
  className,
  live = false,
}: {
  subjectType: "round_two" | "session";
  subjectId: string;
  flows?: AiFlow[];
  limit?: number;
  emptyText?: string;
  className?: string;
  /** Poll while a run is in progress. */
  live?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const q = trpc.aiRuns.forSubject.useQuery(
    { subjectType, subjectId, flows, limit: showAll ? 50 : limit },
    { staleTime: 15_000, keepPreviousData: true, refetchInterval: live ? 3000 : false },
  );
  const runs = q.data?.runs ?? [];
  if (q.isLoading) return null;
  if (!runs.length) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  return (
    <div className={cn("space-y-2", className)}>
      {runs.map((r, i) => (
        <RunCard key={r.id} run={r} defaultOpen={i === 0} />
      ))}
      {!showAll && runs.length >= limit && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
          Show older runs
        </Button>
      )}
      {q.data?.canSeeTraces && !runs.some((r) => r.traceUrl) && (
        <Badge variant="outline" className="text-[11px] font-normal">
          Set LANGFUSE_PUBLIC_URL and LANGFUSE_PROJECT_ID to link runs to Langfuse traces
        </Badge>
      )}
    </div>
  );
}
