"use client";

import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = "last7" | "last30" | "thisMonth";

const PERIODS: { value: Period; label: string }[] = [
  { value: "thisMonth", label: "This month" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
];

const FLOW_COLORS = ["#0d9488", "#2563eb", "#ca8a04", "#db2777", "#7c3aed", "#ea580c", "#64748b"];
const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10a37f",
  gemini: "#4285f4",
  anthropic: "#d97706",
  groq: "#f97316",
  nvidia: "#76b900",
  custom: "#64748b",
  unknown: "#94a3b8",
};

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatInr(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "₹ —";
  if (Math.abs(amount) < 0.01 && amount !== 0) return `₹${amount.toFixed(4)}`;
  if (Math.abs(amount) < 1) return `₹${amount.toFixed(2)}`;
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Catalog USD/MTok → ₹/MTok at current FX. */
function formatInrPerMtok(usdPerMtok: number | null | undefined, usdInr: number): string {
  if (usdPerMtok == null || !Number.isFinite(usdPerMtok) || !Number.isFinite(usdInr)) return "—";
  const inr = usdPerMtok * usdInr;
  if (inr < 1) return `₹${inr.toFixed(2)}`;
  return `₹${inr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function shortDay(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return iso;
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12]"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export default function AiUsagePage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const [period, setPeriod] = useState<Period>("last30");
  const [chartMetric, setChartMetric] = useState<"tokens" | "cost">("tokens");

  const usage = trpc.aiSettings.usageDashboard.useQuery(
    { organizationId: orgId, period },
    { enabled: !!orgId, keepPreviousData: true, staleTime: 20_000 },
  );

  const data = usage.data;
  const totals = data?.totals;
  const maxFlowTokens = Math.max(1, ...(data?.byFlow.map((f) => f.tokens) ?? [1]));

  const byProvider = useMemo(() => {
    const map = new Map<string, { tokens: number; usd: number | null }>();
    for (const m of data?.byModel ?? []) {
      const cur = map.get(m.provider) ?? { tokens: 0, usd: 0 };
      cur.tokens += m.tokens;
      if (m.estimateUsd == null) cur.usd = null;
      else if (cur.usd != null) cur.usd += m.estimateUsd;
      map.set(m.provider, cur);
    }
    return [...map.entries()]
      .map(([provider, v]) => ({
        provider,
        tokens: v.tokens,
        estimateInr: v.usd == null ? null : v.usd * (data?.usdInr ?? 93),
      }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [data?.byModel, data?.usdInr]);

  const chartData = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        ...d,
        label: shortDay(d.date),
      })),
    [data?.daily],
  );

  if (!orgId) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Pick an organization to see AI usage.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Usage</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            ₹ cost for <span className="font-medium text-foreground">paid keys only</span>. Free-tier
            keys still show tokens at ₹0. Rates from catalog (OpenAI list × FX).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void usage.refetch()}
            disabled={usage.isFetching}
          >
            {usage.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>
      </div>

      {usage.isLoading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Total cost"
            value={totals?.estimateInrLabel ?? "₹ —"}
            hint={
              totals?.pricedTokenShare != null && totals.pricedTokenShare < 0.999
                ? `${Math.round(totals.pricedTokenShare * 100)}% of tokens priced`
                : data?.pricesAsOf
                  ? `FX ₹${data.usdInr}/USD · ${new Date(data.pricesAsOf).toLocaleDateString()}`
                  : `FX ₹${data?.usdInr ?? "—"}/USD`
            }
            icon={Coins}
            accent="#0d9488"
          />
          <Kpi
            label="Input cost"
            value={totals?.inputCostInrLabel ?? "₹ —"}
            hint={`${formatTokens(totals?.inputTokens ?? 0)} input tokens`}
            icon={Zap}
            accent="#2563eb"
          />
          <Kpi
            label="Output cost"
            value={totals?.outputCostInrLabel ?? "₹ —"}
            hint={`${formatTokens(totals?.outputTokens ?? 0)} output tokens`}
            icon={Sparkles}
            accent="#db2777"
          />
          <Kpi
            label="Tokens"
            value={formatTokens(totals?.tokens ?? 0)}
            hint={`Paid ${formatTokens(totals?.paidTokens ?? 0)} · Free ${formatTokens(totals?.freeTokens ?? 0)}`}
            icon={Activity}
            accent="#0891b2"
          />
          <Kpi
            label="AI runs"
            value={(totals?.runs ?? 0).toLocaleString()}
            hint="Graph flows in this period"
            icon={Workflow}
            accent="#7c3aed"
          />
          <Kpi
            label="Errors"
            value={(totals?.errors ?? 0).toLocaleString()}
            hint={
              totals?.runs
                ? `${Math.round(((totals.errors ?? 0) / totals.runs) * 100)}% of runs`
                : "No runs yet"
            }
            icon={AlertTriangle}
            accent="#dc2626"
          />
        </div>
      )}

      <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">
        <span className="font-medium text-foreground">₹ pricing (paid keys only): </span>
        (input ÷ 1M) × ₹/MTok<sub>in</sub> + (output ÷ 1M) × ₹/MTok<sub>out</sub>
        {data?.usdInr
          ? ` · FX ₹${Number(data.usdInr).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/USD`
          : ""}
        {totals?.freeTokens
          ? ` · ${formatTokens(totals.freeTokens)} free-tier tokens excluded from cost`
          : ""}
        {totals?.measuredIoShare != null && totals.measuredIoShare < 0.999
          ? ` · ${Math.round((1 - totals.measuredIoShare) * 100)}% legacy ≈70/30 split`
          : ""}
        .
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Timeline
              </p>
              <h3 className="text-sm font-semibold">Daily burn</h3>
            </div>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(
                [
                  ["tokens", "In / out"],
                  ["cost", "₹ cost"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setChartMetric(id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    chartMetric === id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {usage.isLoading && !data ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : chartData.every((d) => d.tokens === 0) ? (
            <EmptyChart />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ai-usage-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ai-usage-in" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="ai-usage-out" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#db2777" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#db2777" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    className="stroke-border/60"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDay}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      chartMetric === "cost" ? formatInr(Number(v)) : formatTokens(Number(v))
                    }
                    width={56}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      color: "hsl(var(--popover-foreground))",
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => shortDay(String(v))}
                    formatter={(value, name) => [
                      chartMetric === "cost"
                        ? formatInr(Number(value))
                        : `${Number(value).toLocaleString()} tokens`,
                      String(name),
                    ]}
                  />
                  {chartMetric === "cost" ? (
                    <Area
                      type="monotone"
                      dataKey="estimateInr"
                      stroke="#0d9488"
                      fill="url(#ai-usage-fill)"
                      strokeWidth={2}
                      name="Est. ₹"
                    />
                  ) : (
                    <>
                      <Area
                        type="monotone"
                        dataKey="inputTokens"
                        stackId="tok"
                        stroke="#2563eb"
                        fill="url(#ai-usage-in)"
                        strokeWidth={2}
                        name="Input"
                      />
                      <Area
                        type="monotone"
                        dataKey="outputTokens"
                        stackId="tok"
                        stroke="#db2777"
                        fill="url(#ai-usage-out)"
                        strokeWidth={2}
                        name="Output"
                      />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Providers
          </p>
          <h3 className="mb-4 text-sm font-semibold">Where tokens went</h3>
          {usage.isLoading && !data ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : !byProvider.length ? (
            <EmptySide />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byProvider}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="provider"
                    width={72}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      fontSize: 12,
                    }}
                    formatter={(value, _n, item) => {
                      const row = item?.payload as { estimateInr: number | null };
                      return [
                        `${formatTokens(Number(value))} · ${formatInr(row?.estimateInr)}`,
                        "Usage",
                      ];
                    }}
                  />
                  <Bar dataKey="tokens" radius={[0, 6, 6, 0]} maxBarSize={22}>
                    {byProvider.map((p) => (
                      <Cell
                        key={p.provider}
                        fill={PROVIDER_COLORS[p.provider] ?? PROVIDER_COLORS.custom}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                By workflow
              </p>
              <h3 className="text-sm font-semibold">What AI is doing</h3>
            </div>
            <Badge variant="secondary" className="font-normal">
              {data?.byFlow.length ?? 0} flows
            </Badge>
          </div>
          {!data?.byFlow.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No AI flows in this window yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.byFlow.map((f, i) => {
                const pct = Math.round((f.tokens / maxFlowTokens) * 100);
                const color = FLOW_COLORS[i % FLOW_COLORS.length];
                return (
                  <li key={f.flow} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{f.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {f.estimateInrLabel}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span>{f.runs} runs</span>
                      <span>in {formatTokens(f.inputTokens)}</span>
                      <span>out {formatTokens(f.outputTokens)}</span>
                      {f.errors > 0 ? (
                        <span className="text-destructive">{f.errors} errors</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                By model
              </p>
              <h3 className="text-sm font-semibold">Which AI gets used</h3>
            </div>
            <Link
              href="/settings/ai/studio"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Tune in Studio
              <Sparkles className="h-3 w-3" />
            </Link>
          </div>
          {!data?.byModel.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No model attribution yet — runs need step metadata.
            </p>
          ) : (
            <div className="max-h-[380px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Model</th>
                    <th className="px-3 py-2 font-semibold">Rate ₹/M</th>
                    <th className="px-3 py-2 text-right font-semibold">Input tok</th>
                    <th className="px-3 py-2 text-right font-semibold">Output tok</th>
                    <th className="px-3 py-2 text-right font-semibold">Input ₹</th>
                    <th className="px-3 py-2 text-right font-semibold">Output ₹</th>
                    <th className="px-3 py-2 text-right font-semibold">Total ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((m) => (
                    <tr key={`${m.provider}-${m.modelId}`} className="border-t border-border/50">
                      <td className="max-w-[180px] px-3 py-2" title={m.modelId}>
                        <div className="truncate font-medium">{m.modelId}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] capitalize text-muted-foreground">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: PROVIDER_COLORS[m.provider] ?? "#64748b",
                            }}
                          />
                          {m.provider}
                          {m.freeTokens > 0 ? (
                            <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-700 dark:text-sky-400">
                              {formatTokens(m.freeTokens)} free
                            </span>
                          ) : null}
                          {m.splitEstimated ? (
                            <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                              est. split
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {m.inputUsdPerMtok != null && m.outputUsdPerMtok != null
                          ? `${formatInrPerMtok(m.inputUsdPerMtok, data.usdInr)} / ${formatInrPerMtok(m.outputUsdPerMtok, data.usdInr)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatTokens(m.inputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatTokens(m.outputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.inputCostInrLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.outputCostInrLabel}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                        {m.estimateInrLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </p>
            <h3 className="text-sm font-semibold">Latest AI runs</h3>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">{data?.estimateNote}</p>
        </div>
        {!data?.recent.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No runs yet. Generate questions, reports, or Round 2 plans to populate this feed.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href="/settings/ai/studio">Open Studio</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.label}</span>
                    <StatusPill status={r.status} />
                    {r.models.slice(0, 3).map((m) => (
                      <Badge key={m} variant="outline" className="font-normal">
                        {m}
                      </Badge>
                    ))}
                    {r.models.length > 3 ? (
                      <span className="text-xs text-muted-foreground">+{r.models.length - 3}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatWhen(r.startedAt)}
                    {r.subjectType && r.subjectId
                      ? ` · ${r.subjectType} ${r.subjectId.slice(0, 8)}…`
                      : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
                  <span className="tabular-nums text-muted-foreground">
                    in {formatTokens(r.inputTokens)} · out {formatTokens(r.outputTokens)}
                    {r.freeTokens > 0 ? ` · ${formatTokens(r.freeTokens)} free` : ""}
                    {r.splitEstimated ? " ≈" : ""}
                  </span>
                  <span className="font-medium tabular-nums">{r.estimateInrLabel}</span>
                  {r.traceUrl ? (
                    <a
                      href={r.traceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Trace
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "error"
        ? "bg-destructive/15 text-destructive"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", tone)}>
      {status}
    </span>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      <Zap className="h-6 w-6 opacity-40" />
      Quiet period — no token burn yet.
    </div>
  );
}

function EmptySide() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <Sparkles className="h-6 w-6 opacity-40" />
      Providers show up after priced / attributed runs.
    </div>
  );
}
