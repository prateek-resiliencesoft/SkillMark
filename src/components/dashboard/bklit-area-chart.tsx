"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaSparkline } from "@bklitui/ui/charts";
import { cn } from "@/lib/utils";

interface BklitAreaChartProps {
  title: string;
  subtitle?: string;
  data: {
    date: string;
    sessions: number;
    sessionMinutes: number;
    messages: number;
    interviews: number;
    questions: number;
    [key: string]: string | number;
  }[];
  loading?: boolean;
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

export function BklitAreaChart({
  title,
  subtitle = "Activity and engagement metrics over the last 30 days",
  data,
  loading = false,
}: BklitAreaChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<
    "sessions" | "sessionMinutes" | "messages"
  >("sessions");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const metricConfig = {
    sessions: {
      label: "Candidate Sessions",
      unit: "sessions",
      stroke: "#5941F2",
      gradientStart: "#5941F2",
      gradientEnd: "#296CF2",
    },
    sessionMinutes: {
      label: "Total Duration",
      unit: "mins",
      stroke: "#296CF2",
      gradientStart: "#296CF2",
      gradientEnd: "#277FF2",
    },
    messages: {
      label: "AI Messages",
      unit: "messages",
      stroke: "#0511F2",
      gradientStart: "#0511F2",
      gradientEnd: "#5941F2",
    },
  }[selectedMetric];

  const totalForMetric = React.useMemo(() => {
    return data.reduce((acc, curr) => acc + (Number(curr[selectedMetric]) || 0), 0);
  }, [data, selectedMetric]);

  const activeHoverDatum = hoveredIndex !== null && data[hoveredIndex] ? data[hoveredIndex] : null;

  return (
    <Card className="border-border/60 bg-card">
      {/* Hidden SVG defs to preserve gradient references and compatibility */}
      <svg className="hidden" aria-hidden="true">
        <defs>
          <linearGradient id="bklitAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={metricConfig.gradientStart} stopOpacity={0.45} />
            <stop offset="95%" stopColor={metricConfig.gradientEnd} stopOpacity={0.0} />
          </linearGradient>
        </defs>
      </svg>

      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="font-heading text-lg font-bold tracking-tight">
            {title}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>

        {/* Bklit Segmented Metric Switcher */}
        <div className="flex items-center rounded-lg border border-border/60 bg-muted/50 p-1">
          {(
            [
              { key: "sessions", label: "Sessions" },
              { key: "sessionMinutes", label: "Duration" },
              { key: "messages", label: "Messages" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setSelectedMetric(m.key);
                setHoveredIndex(null);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
                selectedMetric === m.key
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {/* Metric highlight banner & active hover readout */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              30-Day Total:
            </span>
            {loading ? (
              <Skeleton className="h-6 w-24 rounded" />
            ) : (
              <span className="font-heading text-xl font-bold text-foreground">
                {totalForMetric.toLocaleString()}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {metricConfig.unit}
                </span>
              </span>
            )}
          </div>

          {activeHoverDatum && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-muted/60 px-2.5 py-1 text-xs backdrop-blur-xs">
              <span className="font-medium text-muted-foreground">
                {formatShortDate(activeHoverDatum.date)}:
              </span>
              <span className="font-heading font-bold text-foreground">
                {Number(activeHoverDatum[selectedMetric] || 0).toLocaleString()} {metricConfig.unit}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex h-64 flex-col justify-between py-3">
            <div className="space-y-7">
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-px w-full" />
            </div>
            <div className="flex justify-between pt-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-10 rounded" />
              ))}
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No activity data available
          </div>
        ) : (
          <div className="relative h-64 w-full flex flex-col justify-between pt-2">
            {/* Official Bklit AreaSparkline component for Interview Activity & Volume */}
            <div className="w-full flex-1 min-h-0">
              <AreaSparkline
                data={data}
                dataKey={selectedMetric}
                height={210}
                color={metricConfig.stroke}
                curve="monotone"
                fill="gradient"
                fillOpacity={0.32}
                strokeWidth={2.5}
                crosshair="dashed"
                dot={true}
                endDot={true}
                animate={true}
                showHighlight={true}
                hoverIndex={hoveredIndex}
                onHoverChange={setHoveredIndex}
                className="w-full overflow-visible"
              />
            </div>

            {/* X-Axis Date Timeline */}
            <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px] font-medium text-muted-foreground select-none">
              <span>{formatShortDate(data[0]?.date ?? "")}</span>
              {data.length > 2 && (
                <span>
                  {formatShortDate(data[Math.floor(data.length / 2)]?.date ?? "")}
                </span>
              )}
              <span>{formatShortDate(data[data.length - 1]?.date ?? "")}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
