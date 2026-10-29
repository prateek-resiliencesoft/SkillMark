"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hugeicon, TrendingUpIcon } from "@/components/ui/hugeicon";
import { AreaSparkline } from "@bklitui/ui/charts";

export interface BklitStatCardProps {
  title: string;
  value?: string | number;
  subtitle?: string;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  icon: React.ElementType;
  sparklineData?: number[];
  accentColor?: string; // hex or tailwind class
  loading?: boolean;
}

/**
 * Generates an SVG path string from an array of numbers for a mini sparkline
 * (Maintained for backward-compatibility with custom SVG renderers)
 */
export function createSparklinePath(data: number[], width = 120, height = 36): { linePath: string; areaPath: string } {
  if (!data || data.length < 2) {
    const mid = height / 2;
    return {
      linePath: `M 0,${mid} L ${width},${mid}`,
      areaPath: `M 0,${mid} L ${width},${mid} L ${width},${height} L 0,${height} Z`,
    };
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 3;
  const usableHeight = height - padding * 2;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * usableHeight;
    return { x, y };
  });

  let linePath = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cpX = (curr.x + next.x) / 2;
    linePath += ` C ${cpX.toFixed(1)},${curr.y.toFixed(1)} ${cpX.toFixed(1)},${next.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }

  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return { linePath, areaPath };
}

export function BklitStatCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  sparklineData,
  accentColor = "#5941F2",
  loading = false,
}: BklitStatCardProps) {
  // Map real numerical sparkline data for Bklit AreaSparkline
  const chartData = React.useMemo(() => {
    if (!Array.isArray(sparklineData) || sparklineData.length === 0) {
      return [];
    }
    return sparklineData.map((val, idx) => ({ value: val, index: idx }));
  }, [sparklineData]);

  return (
    <Card className="group relative overflow-hidden border-border/60 bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md">
      {/* Top Accent Color Line with smooth linearGradient */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          background: `linear-gradient(90deg, ${accentColor}, #296CF2)`,
        }}
      />

      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-sans">
            {title}
          </span>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110"
            style={{
              backgroundColor: `${accentColor}18`,
              color: accentColor,
            }}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-8 w-24 rounded" />
                <Skeleton className="h-3.5 w-28 rounded" />
              </div>
            ) : (
              <>
                <div className="font-heading text-3xl font-bold tracking-tight text-foreground">
                  {value ?? 0}
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {trend && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                      <Hugeicon icon={TrendingUpIcon} className="h-3 w-3" />
                      {trend}
                    </span>
                  )}
                  {subtitle && <span>{subtitle}</span>}
                </div>
              </>
            )}
          </div>

          {/* Mini Sparkline Visualization using official Bklit AreaSparkline (SVG linearGradient fill) */}
          <div className="relative h-10 w-28 shrink-0 overflow-visible flex items-center justify-end">
            {loading ? (
              <Skeleton className="h-8 w-24 rounded-md" />
            ) : chartData.length > 0 ? (
              <AreaSparkline
                data={chartData}
                dataKey="value"
                width={112}
                height={36}
                color={accentColor}
                curve="monotone"
                fill="gradient"
                fillOpacity={0.25}
                strokeWidth={2}
                endDot
                animate
                className="overflow-visible"
              />
            ) : (
              <div className="h-[2px] w-20 rounded-full bg-muted/60" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
