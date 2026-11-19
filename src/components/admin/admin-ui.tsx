"use client";

/**
 * Superadmin Modern Ops Center UI System
 * Inspired by Linear, Vercel, and Raycast:
 * - Subsurface 1px borders & inner lighting highlights
 * - High-density data presentation & micro-typography
 * - Mechanical micro-press interactions
 * - Consistent status pill signaling with glowing live dots
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Loader2,
  Search,
  X,
} from "lucide-react";
import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export const CHART_COLORS = [
  "#5941F2",
  "#296CF2",
  "#277FF2",
  "#0511F2",
  "#8B5CF6",
  "#06B6D4",
  "#10B981",
];

export const STATUS_COLORS: Record<string, string> = {
  // Candidate / Interview status
  COMPLETED: "#10b981",
  IN_PROGRESS: "#5941F2",
  ABANDONED: "#f59e0b",
  DISQUALIFIED: "#ef4444",
  // Organization & Account status
  ACTIVE: "#10b981",
  SUSPENDED: "#f59e0b",
  DELETED: "#ef4444",
  PENDING: "#6366f1",
  // System / Health status
  HEALTHY: "#10b981",
  ONLINE: "#10b981",
  DEGRADED: "#f59e0b",
  WARNING: "#f59e0b",
  DOWN: "#ef4444",
  CRITICAL: "#ef4444",
  ERROR: "#ef4444",
  UNKNOWN: "#6b7280",
};

export const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  ABANDONED: "Abandoned",
  DISQUALIFIED: "Disqualified",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DELETED: "Deleted",
  PENDING: "Pending",
  HEALTHY: "Healthy",
  ONLINE: "Online",
  DEGRADED: "Degraded",
  WARNING: "Warning",
  DOWN: "Offline",
  CRITICAL: "Critical",
  ERROR: "Error",
};

// ---------------------------------------------------------------------------
// Page Header & Section Framing
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  kicker,
  breadcrumbs,
  actions,
  className,
}: {
  title: string;
  description?: string;
  kicker?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 font-medium">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.label + idx}>
                {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                {crumb.href ? (
                  <a
                    href={crumb.href}
                    className="hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-foreground/90">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </div>
        ) : kicker ? (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            {kicker}
          </span>
        ) : null}

        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="max-w-2xl text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tactical Panel / Card (Linear & Vercel Ops style)
// ---------------------------------------------------------------------------

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  kicker,
  borderAccent,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  kicker?: string;
  borderAccent?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm transition-all duration-200",
        "dark:border-white/[0.08] dark:bg-zinc-950/50 dark:backdrop-blur-md",
        "dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.3)]",
        "hover:border-border dark:hover:border-white/[0.14]",
        borderAccent && "before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:rounded-t-xl before:bg-gradient-to-r before:from-primary/60 before:via-primary before:to-primary/60",
        className,
      )}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-5 py-3.5 dark:border-white/[0.06]">
          <div className="space-y-0.5">
            {kicker && (
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {kicker}
              </span>
            )}
            {typeof title === "string" ? (
              <h3 className="font-heading text-sm font-semibold tracking-tight text-foreground sm:text-base">
                {title}
              </h3>
            ) : (
              title
            )}
            {typeof description === "string" ? (
              <p className="text-xs text-muted-foreground leading-normal">{description}</p>
            ) : (
              description
            )}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tactical Stat Card (Data Dense KPI Tile)
// ---------------------------------------------------------------------------

export interface StatCardProps {
  title: string;
  value?: string | number | null;
  subtitle?: ReactNode;
  icon?: React.ElementType;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  accentColor?: string;
  sparklineData?: number[];
  loading?: boolean;
  className?: string;
  badge?: ReactNode;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendDirection = "neutral",
  accentColor = "#5941F2",
  sparklineData,
  loading,
  className,
  badge,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-card-foreground shadow-sm transition-all duration-200",
        "dark:border-white/[0.08] dark:bg-zinc-950/60 dark:backdrop-blur-sm",
        "dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.3)]",
        "hover:border-border dark:hover:border-white/[0.15] hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          {loading ? (
            <Skeleton className="my-1 h-8 w-24 rounded-md" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-2xl font-bold tracking-tight text-foreground tabular-nums sm:text-3xl">
                {value ?? "0"}
              </span>
              {trend ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    trendDirection === "up" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
                    trendDirection === "down" && "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
                    trendDirection === "neutral" && "bg-muted text-muted-foreground border border-border/50",
                  )}
                >
                  {trendDirection === "up" ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : trendDirection === "down" ? (
                    <ArrowDownRight className="h-3 w-3" />
                  ) : null}
                  {trend}
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {badge}
          {Icon ? (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/40 text-foreground/80 dark:border-white/[0.06] dark:bg-zinc-900"
              style={{ color: accentColor }}
            >
              <Icon className="h-4 w-4" />
            </div>
          ) : null}
        </div>
      </div>

      {subtitle ? (
        <div className="mt-3 pt-2 text-xs text-muted-foreground border-t border-border/40 dark:border-white/[0.04]">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tactical Button
// ---------------------------------------------------------------------------

export interface TacticalButtonProps extends ButtonProps {
  loading?: boolean;
  glow?: boolean;
}

export const TacticalButton = forwardRef<HTMLButtonElement, TacticalButtonProps>(
  ({ className, variant = "default", size = "default", loading, glow, children, disabled, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        disabled={disabled || loading}
        className={cn(
          "relative font-medium transition-all duration-150 active:scale-[0.98] select-none",
          // Enhanced glow on primary
          variant === "default" && "shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.4)]",
          glow && variant === "default" && "shadow-[0_0_14px_rgba(89,65,242,0.4)] hover:shadow-[0_0_20px_rgba(89,65,242,0.6)]",
          // Refined outline & secondary
          variant === "outline" && "border-border/80 dark:border-white/[0.12] hover:bg-muted/60 dark:hover:bg-zinc-900 text-foreground",
          variant === "secondary" && "bg-secondary/70 hover:bg-secondary dark:bg-zinc-900 dark:hover:bg-zinc-800 text-foreground border border-border/40 dark:border-white/[0.06]",
          variant === "destructive" && "bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white border border-rose-500/20 dark:text-rose-400",
          className,
        )}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>Processing…</span>
          </>
        ) : (
          children
        )}
      </Button>
    );
  },
);
TacticalButton.displayName = "TacticalButton";

// ---------------------------------------------------------------------------
// Status Signaling & Pills
// ---------------------------------------------------------------------------

export function StatusPill({
  status,
  label,
  pulse = true,
  className,
}: {
  status: string;
  label?: string;
  pulse?: boolean;
  className?: string;
}) {
  const norm = (status || "").toUpperCase();
  const color = STATUS_COLORS[norm] ?? "#6b7280";
  const displayLabel = label ?? (STATUS_LABEL[norm] || status);
  const isHealthy = norm === "ACTIVE" || norm === "HEALTHY" || norm === "ONLINE" || norm === "COMPLETED";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium tracking-tight text-foreground transition-colors",
        "dark:border-white/[0.08] dark:bg-zinc-900/60",
        className,
      )}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        {pulse && isHealthy && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      </span>
      <span>{displayLabel}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Meter & Progress Bar
// ---------------------------------------------------------------------------

export function Meter({
  percent,
  tone = "ok",
  height = "h-2",
  showStripes = false,
}: {
  percent: number | null;
  tone?: "ok" | "warn" | "critical";
  height?: string;
  showStripes?: boolean;
}) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-muted/60 dark:bg-zinc-900 border border-border/40 dark:border-white/[0.05]", height)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          tone === "critical"
            ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
            : tone === "warn"
              ? "bg-gradient-to-r from-amber-400 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]"
              : "bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_8px_rgba(89,65,242,0.3)]",
        )}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Bar & Search Container
// ---------------------------------------------------------------------------

export function FilterBar({
  query,
  onQueryChange,
  placeholder = "Search…",
  children,
  resultCount,
  onClear,
  className,
}: {
  query?: string;
  onQueryChange?: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
  resultCount?: number;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/40 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        {onQueryChange ? (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              type="text"
              value={query || ""}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={placeholder}
              className="h-9 w-full rounded-lg border border-border/70 bg-background/80 pl-9 pr-8 text-xs font-medium placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-white/[0.08] dark:bg-zinc-900/80"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {children}
      </div>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        {resultCount != null ? (
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
            {resultCount} {resultCount === 1 ? "result" : "results"}
          </span>
        ) : null}
        {onClear && query ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dense Operations Data Table
// ---------------------------------------------------------------------------

export function DataTableWrapper({
  children,
  className,
  tableClassName,
}: {
  children: ReactNode;
  className?: string;
  /** Extra classes for the <table> itself, e.g. "table-fixed min-w-[900px]". */
  tableClassName?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/40",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className={cn("w-full text-left text-xs", tableClassName)}>{children}</table>
      </div>
    </div>
  );
}

export function TableHeadRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:border-white/[0.06] dark:bg-zinc-900/60">
        {children}
      </tr>
    </thead>
  );
}

export function TableRow({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-border/40 transition-colors hover:bg-muted/30 dark:border-white/[0.04] dark:hover:bg-zinc-900/40",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-10 text-center dark:border-white/[0.1] bg-card/40 dark:bg-zinc-950/20",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-muted-foreground dark:border-white/[0.08] dark:bg-zinc-900">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatBytes(v: number | null | undefined) {
  if (v == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Math.abs(v);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
