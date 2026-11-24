"use client";

import type { ReactNode } from "react";
import {
  getSessionScoreBreakdown,
  type NamedScore,
  type ScoreGroup,
  type SessionScoreBreakdown,
} from "@/lib/session-score";
import { scoreColor } from "@/lib/report-data";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function scoreTextClass(score: number): string {
  if (score >= 7) return "text-green-700 dark:text-green-400";
  if (score >= 4) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function truncate(label: string, max = 42): string {
  const t = label.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function GroupBlock({
  title,
  group,
  maxItems = 6,
}: {
  title: string;
  group: ScoreGroup;
  maxItems?: number;
}) {
  if (group.avg === null && group.items.length === 0) return null;
  const shown = group.items.slice(0, maxItems);
  const more = group.items.length - shown.length;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        {group.avg !== null && (
          <span className="tabular-nums normal-case tracking-normal" style={{ color: scoreColor(group.avg) }}>
            {group.avg.toFixed(1)}/10
          </span>
        )}
      </div>
      {shown.map((item, i) => (
        <div key={`${item.label}-${i}`} className="flex items-start justify-between gap-3 text-xs">
          <span className="min-w-0 flex-1 text-popover-foreground/90">{truncate(item.label)}</span>
          <span className="shrink-0 tabular-nums font-medium" style={{ color: scoreColor(item.score) }}>
            {Number.isInteger(item.score) ? item.score : item.score.toFixed(1)}
          </span>
        </div>
      ))}
      {more > 0 && (
        <p className="text-[11px] text-muted-foreground">+{more} more</p>
      )}
    </div>
  );
}

export function ScoreBreakdownBody({
  breakdown,
  className,
}: {
  breakdown: SessionScoreBreakdown;
  className?: string;
}) {
  const sourceNote =
    breakdown.source === "questions"
      ? "Overall = average of question scores"
      : breakdown.source === "criteria"
        ? "Overall = average of skill scores"
        : null;

  return (
    <div className={cn("space-y-2.5", className)}>
      {breakdown.overall !== null && (
        <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
          <span className="text-xs font-semibold">Overall</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: scoreColor(breakdown.overall) }}>
            {breakdown.overall.toFixed(1)}/10
          </span>
        </div>
      )}
      {sourceNote && <p className="text-[11px] text-muted-foreground">{sourceNote}</p>}
      <GroupBlock title="Questions" group={breakdown.questions} />
      <GroupBlock title="Skills" group={breakdown.criteria} />
      <GroupBlock title="Coding" group={breakdown.coding} />
    </div>
  );
}

/** Compact chips for report hero — Questions / Skills / Coding averages. */
export function ScoreDistributionChips({
  breakdown,
  className,
}: {
  breakdown: SessionScoreBreakdown;
  className?: string;
}) {
  const chips: { label: string; avg: number }[] = [];
  if (breakdown.questions.avg !== null) chips.push({ label: "Questions", avg: breakdown.questions.avg });
  if (breakdown.criteria.avg !== null) chips.push({ label: "Skills", avg: breakdown.criteria.avg });
  if (breakdown.coding.avg !== null) chips.push({ label: "Coding", avg: breakdown.coding.avg });
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap justify-center gap-1.5", className)}>
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[11px] font-medium"
        >
          <span className="text-muted-foreground">{c.label}</span>
          <span className="tabular-nums font-semibold" style={{ color: scoreColor(c.avg) }}>
            {c.avg.toFixed(1)}
          </span>
        </span>
      ))}
    </div>
  );
}

type ScoreWithBreakdownProps = {
  insights: unknown;
  className?: string;
  /** Empty / missing score placeholder. */
  empty?: ReactNode;
  /** Badge-style (detail sheet) vs table cell. */
  variant?: "table" | "badge";
};

export function ScoreWithBreakdown({
  insights,
  className,
  empty = <span className="text-muted-foreground">-</span>,
  variant = "table",
}: ScoreWithBreakdownProps) {
  const breakdown = getSessionScoreBreakdown(insights);
  if (breakdown.overall === null) return <>{empty}</>;

  const hasDetail =
    breakdown.questions.items.length > 0 ||
    breakdown.criteria.items.length > 0 ||
    breakdown.coding.items.length > 0;

  const scoreEl =
    variant === "badge" ? (
      <span
        className={cn(
          "inline-flex cursor-default items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
          className,
        )}
      >
        Score {Math.round(breakdown.overall)}
      </span>
    ) : (
      <span
        className={cn(
          "cursor-default font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2",
          scoreTextClass(breakdown.overall),
          className,
        )}
      >
        {breakdown.overall.toFixed(1)}/10
      </span>
    );

  if (!hasDetail) return scoreEl;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="inline-flex max-w-full text-left">
            {scoreEl}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-[280px] space-y-0 border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <ScoreBreakdownBody breakdown={breakdown} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type { NamedScore, SessionScoreBreakdown };
