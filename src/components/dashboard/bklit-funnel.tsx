"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hugeicon, FilterIcon } from "@/components/ui/hugeicon";

interface FunnelStage {
  name: string;
  count: number;
  color: string;
}

interface BklitFunnelProps {
  title?: string;
  subtitle?: string;
  stages: FunnelStage[];
  loading?: boolean;
}

export function BklitFunnel({
  title = "Candidate Interview Funnel",
  subtitle = "Conversion rates across candidate assessment lifecycle",
  stages,
  loading = false,
}: BklitFunnelProps) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="font-heading text-lg font-bold tracking-tight">
            {title}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Hugeicon icon={FilterIcon} className="h-4 w-4" />
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        {loading ? (
          <div className="space-y-3.5 py-1">
            {[100, 80, 65, 50, 35].map((w, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3.5 w-32 rounded" />
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3.5 w-12 rounded" />
                    <Skeleton className="h-3.5 w-8 rounded" />
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-muted-foreground/20 shimmer-wave"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3.5">
            {stages.map((stage, idx) => {
              const percentage = Math.round((stage.count / maxCount) * 100);
              const prevCount = idx > 0 ? stages[idx - 1].count : stage.count;
              const stepConversion =
                prevCount > 0 ? Math.round((stage.count / prevCount) * 100) : 100;

              return (
                <div key={stage.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-2 text-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      {stage.name}
                    </span>
                    <div className="flex items-center gap-3">
                      {idx > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {stepConversion}% step conv.
                        </span>
                      )}
                      <span className="font-heading font-bold text-foreground">
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Funnel Bar */}
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${Math.max(percentage, 4)}%`,
                        backgroundColor: stage.color,
                        boxShadow: `0 0 10px ${stage.color}40`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
