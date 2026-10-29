"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hugeicon, Award01Icon } from "@/components/ui/hugeicon";
import { Gauge } from "@bklitui/ui/charts";
import { cn } from "@/lib/utils";

interface BklitRadialGaugeProps {
  score: number; // 0 - 10
  title?: string;
  subtitle?: string;
  completionRate?: number; // 0 - 100
  totalEvaluated?: number;
  loading?: boolean;
}

export function BklitRadialGauge({
  score = 0,
  title = "Candidate Performance Index",
  subtitle = "AI evaluation score benchmark & completion efficiency",
  completionRate = 0,
  totalEvaluated = 0,
  loading = false,
}: BklitRadialGaugeProps) {
  const normalizedScore = Math.min(Math.max(score, 0), 10);
  const fillPercent = Math.round(normalizedScore * 10);

  const scoreTier =
    totalEvaluated === 0
      ? { label: "Awaiting Evaluations", color: "#64748B", bg: "bg-muted", text: "text-muted-foreground" }
      : score >= 8.0
        ? { label: "Top Tier Talent", color: "#5941F2", bg: "bg-[#5941F2]/10", text: "text-[#5941F2]" }
        : score >= 6.0
          ? { label: "Strong Qualified", color: "#296CF2", bg: "bg-[#296CF2]/10", text: "text-[#296CF2]" }
          : { label: "Needs Review", color: "#0511F2", bg: "bg-[#0511F2]/10", text: "text-[#0511F2]" };

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg font-bold tracking-tight">
            {title}
          </CardTitle>
          {loading ? (
            <Skeleton className="h-5 w-28 rounded-full" />
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                scoreTier.bg,
                scoreTier.text,
              )}
            >
              <Hugeicon icon={Award01Icon} className="h-3 w-3" />
              {scoreTier.label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>

      <CardContent className="pt-2">
        {loading ? (
          <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2 py-4">
            {/* Left Arc Skeleton */}
            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="relative flex h-36 w-44 items-end justify-center">
                <Skeleton className="h-32 w-44 rounded-t-full border-8 border-b-0 border-muted" />
                <div className="absolute bottom-2 flex flex-col items-center space-y-1">
                  <Skeleton className="h-6 w-16 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              </div>
            </div>
            {/* Right Linear Skeleton */}
            <div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-muted/20 p-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-3.5 w-24 rounded" />
                  <Skeleton className="h-4 w-10 rounded" />
                </div>
                <Skeleton className="h-3 w-40 rounded" />
              </div>
              <Skeleton className="h-3.5 w-full rounded" />
              <div className="space-y-2 border-t border-border/40 pt-2">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2">
            {/* Primary Notch Arc Gauge for Average Score */}
            <div className="relative flex flex-col items-center justify-center py-2">
              <Gauge
                orientation="arc"
                value={fillPercent}
                centerValue={score}
                defaultLabel="Avg Candidate Score"
                suffix="/10"
                formatOptions={{
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }}
                totalNotches={36}
                spacing={22}
                notchCornerRadius={2.5}
                useGradient
                activeGradient={["#5941F2", "#296CF2"]}
                inactiveFill="hsl(var(--muted))"
                inactiveFillOpacity={0.3}
                minWidth={0}
                className="w-full max-w-[260px]"
              />
            </div>

            {/* Secondary Completion Rate & Breakdown with Bklit Linear Gauge */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-border/50 bg-muted/20 p-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Completion Rate
                  </h4>
                  <span className="font-heading text-sm font-bold text-foreground">
                    {completionRate}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {completionRate}% of candidates finish full assessment
                </p>
              </div>

              {/* Bklit Linear Notch Track */}
              <div className="py-1">
                <Gauge
                  orientation="linear"
                  value={completionRate}
                  totalNotches={30}
                  spacing={16}
                  linearHeight={14}
                  notchCornerRadius={2}
                  useGradient
                  activeGradient={["#296CF2", "#5941F2"]}
                  inactiveFill="hsl(var(--muted))"
                  inactiveFillOpacity={0.3}
                  minWidth={0}
                  className="w-full"
                />
              </div>

              {/* Pipeline summary & Evaluated count */}
              <div className="space-y-2 border-t border-border/40 pt-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pipeline Status:</span>
                  <span className="font-medium text-foreground">
                    {completionRate >= 80
                      ? "High Engagement"
                      : completionRate >= 50
                        ? "Steady Progression"
                        : "Early Stage"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Evaluated:</span>
                  <span className="font-semibold text-foreground">
                    {totalEvaluated} sessions
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
