"use client";

import { CATEGORY_LABELS, ERROR_CATEGORIES, type ErrorCategory } from "@/lib/session-error-log";
import type { ErrorLogReport } from "@/lib/error-log-report";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS: Record<ErrorCategory, string> = {
  ai: "#5941F2",
  rate_limit: "#f59e0b",
  voice: "#0ea5e9",
  tts_stt: "#10b981",
  report: "#ef4444",
  client: "#8b5cf6",
  anti_cheat: "#ec4899",
  other: "#94a3b8",
};

function label(iso: string, bucket: "hour" | "day") {
  const d = new Date(iso);
  return bucket === "hour"
    ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Stacked bars of error events per hour (short ranges) or per day, colored by category. */
export function ErrorSeriesChart({ series, bucket }: { series: ErrorLogReport["series"]; bucket: "hour" | "day" }) {
  const data = series.map((p) => ({ label: label(p.t, bucket), ...p.byCategory }));
  const used = ERROR_CATEGORIES.filter((c) => series.some((p) => (p.byCategory[c] ?? 0) > 0));
  if (!used.length) {
    return <p className="py-10 text-center text-xs text-muted-foreground">No errors in this range.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.1} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            formatter={(value, name) => [value, CATEGORY_LABELS[name as ErrorCategory] ?? String(name)]}
          />
          <Legend formatter={(v) => CATEGORY_LABELS[v as ErrorCategory] ?? v} wrapperStyle={{ fontSize: 11 }} />
          {used.map((c) => (
            <Bar key={c} dataKey={c} stackId="errors" fill={COLORS[c]} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
