"use client";

import { useMemo } from "react";
import { BarSparkline, useSparklineHover } from "@bklitui/ui/charts";

export type LatencyPoint = { at: number; ms: number };

type Row = { value: number; at: number; label: string };

function formatMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatAt(at: number) {
  try {
    return new Date(at * 1000).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

export function MonitorLatencySparkline({
  points,
  color = "hsl(var(--primary))",
  className,
}: {
  points: LatencyPoint[];
  color?: string;
  className?: string;
}) {
  const data = useMemo<Row[]>(
    () =>
      points.map((p) => ({
        value: p.ms,
        at: p.at,
        label: formatAt(p.at),
      })),
    [points],
  );

  const hover = useSparklineHover<Row>();
  const shown = hover.datum ?? data.at(-1);

  if (data.length < 2) {
    return (
      <p className="text-[11px] text-muted-foreground">No latency samples yet</p>
    );
  }

  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Latency</span>
        <span className="tabular-nums text-foreground">
          {shown ? (
            <>
              {shown.label ? `${shown.label} · ` : null}
              {formatMs(shown.value)}
            </>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="h-10 w-full min-w-[8rem]">
        <BarSparkline
          data={data}
          dataKey="value"
          height={40}
          barGap={2}
          barRadius={2}
          color={color}
          crosshair="dashed"
          {...hover.sparklineProps}
        />
      </div>
    </div>
  );
}
