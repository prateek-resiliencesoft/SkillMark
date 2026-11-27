import { FLOW_LABELS, type AiFlow, type ReasoningStep } from "@/lib/ai/graph/types";
import type { CatalogModel } from "./suitability";
import { estimateUsdFromIoTokens, formatInr, usdToInr } from "./pricing";

export type UsagePeriod = "last7" | "last30" | "thisMonth";

export type AiRunRow = {
  id: string;
  flow: string;
  status: string;
  tokens: number;
  steps: ReasoningStep[] | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  subjectType: string | null;
  subjectId: string | null;
};

export type ModelUsageBucket = {
  modelId: string;
  provider: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens from paid keys (₹ billable). */
  paidTokens: number;
  /** Tokens from free-tier keys (₹0). */
  freeTokens: number;
  calls: number;
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  estimateUsd: number | null;
  estimateInr: number | null;
  estimateInrLabel: string;
  inputCostInrLabel: string;
  outputCostInrLabel: string;
  /** True when in/out split was guessed (legacy total-only steps). */
  splitEstimated: boolean;
};

export type FlowUsageBucket = {
  flow: string;
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  runs: number;
  errors: number;
  estimateUsd: number | null;
  estimateInr: number | null;
  estimateInrLabel: string;
};

export type DailyUsagePoint = {
  date: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  runs: number;
  estimateInr: number;
};

/** Guess provider from a model id when catalog has no row. */
export function guessProvider(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.includes("gemini") || m.startsWith("models/gemini")) return "gemini";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("groq") || m.includes("gpt-oss") || m.includes("llama-3") || m.includes("llama3")) return "groq";
  if (m.includes("nvidia") || m.startsWith("meta/") || m.startsWith("nvidia/")) return "nvidia";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai";
  return "custom";
}

function catalogRate(
  catalog: CatalogModel[],
  modelId: string,
): { provider: string; inRate: number | null; outRate: number | null } {
  const hit = catalog.find((c) => c.modelId === modelId);
  if (hit) {
    return {
      provider: hit.provider,
      inRate: hit.inputUsdPerMtok ?? null,
      outRate: hit.outputUsdPerMtok ?? null,
    };
  }
  return { provider: guessProvider(modelId), inRate: null, outRate: null };
}

/**
 * Cost from real input/output tokens × catalog $/MTok (OpenAI list-price formula).
 * When only a total is known, fall back to ~70% input / 30% output.
 */
export function estimateUsdForTokens(
  tokens: number,
  inRate: number | null,
  outRate: number | null,
  inputTokens?: number,
  outputTokens?: number,
): number | null {
  const hasIo =
    inputTokens != null &&
    outputTokens != null &&
    (inputTokens > 0 || outputTokens > 0 || tokens <= 0);
  const inn = hasIo ? Math.max(0, inputTokens!) : tokens * 0.7;
  const out = hasIo ? Math.max(0, outputTokens!) : tokens * 0.3;
  return estimateUsdFromIoTokens(inn, out, inRate, outRate);
}

type Attr = {
  modelId: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  splitEstimated: boolean;
  /** Only paid-key (or legacy/env) tokens contribute to ₹ cost. */
  billable: boolean;
};

function pushModelAttrs(
  attrs: Attr[],
  models: string[],
  inputTokens: number,
  outputTokens: number,
  calls: number,
  splitEstimated: boolean,
  billable: boolean,
) {
  const list = models.length ? models : ["unknown"];
  const tokens = inputTokens + outputTokens;
  const eachTok = tokens / list.length;
  const eachIn = inputTokens / list.length;
  const eachOut = outputTokens / list.length;
  for (const modelId of list) {
    attrs.push({
      modelId,
      tokens: eachTok,
      inputTokens: eachIn,
      outputTokens: eachOut,
      calls,
      splitEstimated,
      billable,
    });
  }
}

function attributeRun(run: AiRunRow): Attr[] {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const attrs: Attr[] = [];
  let stepped = 0;
  for (const s of steps) {
    const tok = Math.max(0, s.tokens ?? 0);
    const prompt = s.promptTokens;
    const completion = s.completionTokens;
    const hasIo = prompt != null || completion != null;
    const hasTier =
      s.paidPromptTokens != null ||
      s.paidCompletionTokens != null ||
      s.freePromptTokens != null ||
      s.freeCompletionTokens != null;
    const models = s.models?.filter(Boolean) ?? [];
    if (!tok && !hasIo && !hasTier && !models.length) continue;

    if (hasTier) {
      const paidIn = Math.max(0, s.paidPromptTokens ?? 0);
      const paidOut = Math.max(0, s.paidCompletionTokens ?? 0);
      const freeIn = Math.max(0, s.freePromptTokens ?? 0);
      const freeOut = Math.max(0, s.freeCompletionTokens ?? 0);
      if (paidIn > 0 || paidOut > 0) {
        pushModelAttrs(attrs, models, paidIn, paidOut, 1, false, true);
        stepped += paidIn + paidOut;
      }
      if (freeIn > 0 || freeOut > 0) {
        pushModelAttrs(attrs, models, freeIn, freeOut, paidIn || paidOut ? 0 : 1, false, false);
        stepped += freeIn + freeOut;
      }
      continue;
    }

    // Legacy steps (no key-tier fields): treat as billable paid so we don't under-report.
    const inputTokens = hasIo ? Math.max(0, prompt ?? 0) : tok * 0.7;
    const outputTokens = hasIo ? Math.max(0, completion ?? 0) : tok * 0.3;
    pushModelAttrs(attrs, models, inputTokens, outputTokens, 1, !hasIo, true);
    stepped += inputTokens + outputTokens || tok;
  }
  const remainder = Math.max(0, (run.tokens ?? 0) - stepped);
  if (remainder > 0 || attrs.length === 0) {
    pushModelAttrs(
      attrs,
      ["unknown"],
      (remainder || (run.tokens ?? 0)) * 0.7,
      (remainder || (run.tokens ?? 0)) * 0.3,
      attrs.length ? 0 : 1,
      true,
      true,
    );
  }
  return attrs;
}

function moneyLabel(
  usd: number | null,
  usdInr: number,
): { estimateUsd: number | null; estimateInr: number | null; estimateInrLabel: string } {
  if (usd == null || !Number.isFinite(usd)) {
    return { estimateUsd: null, estimateInr: null, estimateInrLabel: "₹ —" };
  }
  const inr = usdToInr(usd, usdInr);
  return { estimateUsd: usd, estimateInr: inr, estimateInrLabel: formatInr(inr) };
}

function sideCostLabel(usd: number | null, usdInr: number): string {
  if (usd == null || !Number.isFinite(usd)) return "₹ —";
  return formatInr(usdToInr(usd, usdInr));
}

export function resolveUsageRange(period: UsagePeriod): { start: Date; end: Date } {
  const end = new Date();
  if (period === "last7") {
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return { start, end };
  }
  if (period === "last30") {
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    return { start, end };
  }
  return { start: new Date(end.getFullYear(), end.getMonth(), 1), end };
}

export function aggregateAiUsage(
  runs: AiRunRow[],
  catalog: CatalogModel[],
  usdInr: number,
  range: { start: Date; end: Date },
) {
  const modelMap = new Map<
    string,
    {
      provider: string;
      tokens: number;
      inputTokens: number;
      outputTokens: number;
      paidTokens: number;
      freeTokens: number;
      calls: number;
      inRate: number | null;
      outRate: number | null;
      inputCostUsd: number | null;
      outputCostUsd: number | null;
      usd: number | null;
      splitEstimated: boolean;
    }
  >();
  const flowMap = new Map<
    string,
    { tokens: number; inputTokens: number; outputTokens: number; runs: number; errors: number; usd: number | null }
  >();
  const dayMap = new Map<
    string,
    { tokens: number; inputTokens: number; outputTokens: number; runs: number; usd: number }
  >();

  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalPaidTokens = 0;
  let totalFreeTokens = 0;
  let totalRuns = 0;
  let totalErrors = 0;
  let totalUsd = 0;
  let totalInputCostUsd = 0;
  let totalOutputCostUsd = 0;
  let pricedBillableTokens = 0;
  let billableTokens = 0;
  let measuredIoTokens = 0;

  for (const run of runs) {
    totalRuns++;
    if (run.status === "error") totalErrors++;
    const toks = Math.max(0, run.tokens ?? 0);
    totalTokens += toks;

    const flow = run.flow || "unknown";
    const f = flowMap.get(flow) ?? {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      runs: 0,
      errors: 0,
      usd: 0,
    };
    f.tokens += toks;
    f.runs += 1;
    if (run.status === "error") f.errors += 1;

    const day = run.startedAt.slice(0, 10);
    const d = dayMap.get(day) ?? { tokens: 0, inputTokens: 0, outputTokens: 0, runs: 0, usd: 0 };
    d.tokens += toks;
    d.runs += 1;

    let runUsd = 0;
    let runInCost = 0;
    let runOutCost = 0;
    let runIn = 0;
    let runOut = 0;
    let runBillable = 0;
    let runPriced = true;

    for (const a of attributeRun(run)) {
      const rates = catalogRate(catalog, a.modelId);
      const key = `${rates.provider}::${a.modelId}`;
      const bucket = modelMap.get(key) ?? {
        provider: rates.provider,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        paidTokens: 0,
        freeTokens: 0,
        calls: 0,
        inRate: rates.inRate,
        outRate: rates.outRate,
        inputCostUsd: 0 as number | null,
        outputCostUsd: 0 as number | null,
        usd: 0 as number | null,
        splitEstimated: false,
      };
      bucket.tokens += a.tokens;
      bucket.inputTokens += a.inputTokens;
      bucket.outputTokens += a.outputTokens;
      bucket.calls += a.calls;
      if (a.billable) bucket.paidTokens += a.tokens;
      else bucket.freeTokens += a.tokens;
      if (a.splitEstimated) bucket.splitEstimated = true;
      if (!a.splitEstimated) measuredIoTokens += a.tokens;

      runIn += a.inputTokens;
      runOut += a.outputTokens;

      // Free-tier keys: count tokens, ₹0 cost.
      if (!a.billable) {
        modelMap.set(key, bucket);
        continue;
      }

      runBillable += a.tokens;
      const inPiece =
        rates.inRate != null && Number.isFinite(rates.inRate)
          ? (a.inputTokens / 1_000_000) * rates.inRate
          : null;
      const outPiece =
        rates.outRate != null && Number.isFinite(rates.outRate)
          ? (a.outputTokens / 1_000_000) * rates.outRate
          : null;
      const piece = estimateUsdForTokens(
        a.tokens,
        rates.inRate,
        rates.outRate,
        a.inputTokens,
        a.outputTokens,
      );

      if (piece == null || inPiece == null || outPiece == null) {
        runPriced = false;
        bucket.usd = null;
        bucket.inputCostUsd = null;
        bucket.outputCostUsd = null;
      } else if (bucket.usd != null && bucket.inputCostUsd != null && bucket.outputCostUsd != null) {
        bucket.usd += piece;
        bucket.inputCostUsd += inPiece;
        bucket.outputCostUsd += outPiece;
        runUsd += piece;
        runInCost += inPiece;
        runOutCost += outPiece;
      }
      modelMap.set(key, bucket);
    }

    totalInputTokens += runIn;
    totalOutputTokens += runOut;
    totalPaidTokens += runBillable;
    totalFreeTokens += Math.max(0, runIn + runOut - runBillable);
    billableTokens += runBillable;
    f.inputTokens += runIn;
    f.outputTokens += runOut;
    d.inputTokens += runIn;
    d.outputTokens += runOut;

    if (runPriced) {
      totalUsd += runUsd;
      totalInputCostUsd += runInCost;
      totalOutputCostUsd += runOutCost;
      pricedBillableTokens += runBillable;
      d.usd += runUsd;
      f.usd = (typeof f.usd === "number" ? f.usd : 0) + runUsd;
    } else if (typeof f.usd === "number") {
      f.usd += runUsd;
    } else {
      f.usd = null;
    }
    dayMap.set(day, d);
    flowMap.set(flow, f);
  }

  const byModel: ModelUsageBucket[] = [...modelMap.entries()]
    .map(([key, v]) => {
      const modelId = key.split("::").slice(1).join("::") || "unknown";
      const money = moneyLabel(v.usd, usdInr);
      return {
        modelId,
        provider: v.provider,
        tokens: Math.round(v.tokens),
        inputTokens: Math.round(v.inputTokens),
        outputTokens: Math.round(v.outputTokens),
        paidTokens: Math.round(v.paidTokens),
        freeTokens: Math.round(v.freeTokens),
        calls: v.calls,
        inputUsdPerMtok: v.inRate,
        outputUsdPerMtok: v.outRate,
        inputCostUsd: v.inputCostUsd,
        outputCostUsd: v.outputCostUsd,
        inputCostInrLabel: sideCostLabel(v.inputCostUsd, usdInr),
        outputCostInrLabel: sideCostLabel(v.outputCostUsd, usdInr),
        splitEstimated: v.splitEstimated,
        ...money,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);

  const byFlow: FlowUsageBucket[] = [...flowMap.entries()]
    .map(([flow, v]) => {
      const money = moneyLabel(v.usd, usdInr);
      return {
        flow,
        label: FLOW_LABELS[flow as AiFlow] ?? flow,
        tokens: Math.round(v.tokens),
        inputTokens: Math.round(v.inputTokens),
        outputTokens: Math.round(v.outputTokens),
        runs: v.runs,
        errors: v.errors,
        ...money,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);

  const daily: DailyUsagePoint[] = [];
  const cursor = new Date(range.start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(range.end);
  endDay.setHours(0, 0, 0, 0);
  while (cursor <= endDay) {
    const date = cursor.toISOString().slice(0, 10);
    const hit = dayMap.get(date);
    daily.push({
      date,
      tokens: Math.round(hit?.tokens ?? 0),
      inputTokens: Math.round(hit?.inputTokens ?? 0),
      outputTokens: Math.round(hit?.outputTokens ?? 0),
      runs: hit?.runs ?? 0,
      estimateInr: hit ? usdToInr(hit.usd, usdInr) : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const totalsMoney = moneyLabel(
    pricedBillableTokens > 0 || billableTokens === 0 ? totalUsd : totalTokens > 0 ? null : 0,
    usdInr,
  );
  const inputMoney = moneyLabel(
    pricedBillableTokens > 0 || billableTokens === 0 ? totalInputCostUsd : totalTokens > 0 ? null : 0,
    usdInr,
  );
  const outputMoney = moneyLabel(
    pricedBillableTokens > 0 || billableTokens === 0 ? totalOutputCostUsd : totalTokens > 0 ? null : 0,
    usdInr,
  );

  return {
    totals: {
      tokens: totalTokens,
      inputTokens: Math.round(totalInputTokens),
      outputTokens: Math.round(totalOutputTokens),
      paidTokens: Math.round(totalPaidTokens),
      freeTokens: Math.round(totalFreeTokens),
      runs: totalRuns,
      errors: totalErrors,
      pricedTokenShare: billableTokens > 0 ? pricedBillableTokens / billableTokens : 1,
      measuredIoShare: totalTokens > 0 ? measuredIoTokens / totalTokens : 1,
      inputCostUsd: inputMoney.estimateUsd,
      outputCostUsd: outputMoney.estimateUsd,
      inputCostInrLabel: inputMoney.estimateInrLabel,
      outputCostInrLabel: outputMoney.estimateInrLabel,
      ...totalsMoney,
    },
    byModel,
    byFlow,
    daily,
    recent: runs.slice(0, 25).map((r) => {
      const attrs = attributeRun(r);
      const inputTokens = Math.round(attrs.reduce((n, a) => n + a.inputTokens, 0));
      const outputTokens = Math.round(attrs.reduce((n, a) => n + a.outputTokens, 0));
      const freeTokens = Math.round(attrs.filter((a) => !a.billable).reduce((n, a) => n + a.tokens, 0));
      const splitEstimated = attrs.some((a) => a.splitEstimated);
      let costUsd: number | null = 0;
      for (const a of attrs) {
        if (!a.billable) continue;
        const rates = catalogRate(catalog, a.modelId);
        const piece = estimateUsdForTokens(
          a.tokens,
          rates.inRate,
          rates.outRate,
          a.inputTokens,
          a.outputTokens,
        );
        if (piece == null) {
          costUsd = null;
          break;
        }
        costUsd += piece;
      }
      const money = moneyLabel(costUsd, usdInr);
      return {
        id: r.id,
        flow: r.flow,
        label: FLOW_LABELS[r.flow as AiFlow] ?? r.flow,
        status: r.status,
        tokens: r.tokens ?? 0,
        inputTokens,
        outputTokens,
        freeTokens,
        splitEstimated,
        estimateInrLabel: money.estimateInrLabel,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        error: r.error,
        models: [
          ...new Set(
            (Array.isArray(r.steps) ? r.steps : []).flatMap((s) => s.models ?? []),
          ),
        ],
        subjectType: r.subjectType,
        subjectId: r.subjectId,
      };
    }),
  };
}
