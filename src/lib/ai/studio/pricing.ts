/** Catalog row fields needed for cost estimates (DB or seed). */
export type PriceableModel = {
  inputUsdPerMtok?: number | null;
  outputUsdPerMtok?: number | null;
  audioInUsdPerMtok?: number | null;
  audioOutUsdPerMtok?: number | null;
  perMinuteUsd?: number | null;
};

export type WorkloadEstimate =
  | { kind: "text"; inputTokens: number; outputTokens: number }
  | { kind: "audio_min"; minutes: number };

/** Convert USD → INR. */
export function usdToInr(usd: number, usdInr: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(usdInr) || usdInr <= 0) return NaN;
  return usd * usdInr;
}

/**
 * OpenAI-style list price: (inputTok / 1M) * inputRate + (outputTok / 1M) * outputRate.
 * Rates are USD per 1M tokens (catalog `inputUsdPerMtok` / `outputUsdPerMtok`).
 */
export function estimateUsdFromIoTokens(
  inputTokens: number,
  outputTokens: number,
  inputUsdPerMtok: number | null | undefined,
  outputUsdPerMtok: number | null | undefined,
): number | null {
  const inn = Math.max(0, inputTokens);
  const out = Math.max(0, outputTokens);
  if (!Number.isFinite(inn) || !Number.isFinite(out)) return null;
  if (inn === 0 && out === 0) return 0;
  if (inputUsdPerMtok == null || outputUsdPerMtok == null) return null;
  if (!Number.isFinite(inputUsdPerMtok) || !Number.isFinite(outputUsdPerMtok)) return null;
  return (inn / 1_000_000) * inputUsdPerMtok + (out / 1_000_000) * outputUsdPerMtok;
}

/** Estimate USD for one canonical workload. Null if rates missing. */
export function estimateWorkloadUsd(model: PriceableModel, workload: WorkloadEstimate): number | null {
  if (workload.kind === "audio_min") {
    if (model.perMinuteUsd != null && Number.isFinite(model.perMinuteUsd)) {
      return model.perMinuteUsd * workload.minutes;
    }
    const ain = model.audioInUsdPerMtok;
    const aout = model.audioOutUsdPerMtok;
    if (ain == null || aout == null) return null;
    // ~25 audio tokens/sec each direction (Gemini brochure); both ways for a live call.
    const tokensPerMin = 25 * 60;
    const inTok = tokensPerMin * workload.minutes;
    const outTok = tokensPerMin * workload.minutes;
    return (inTok / 1_000_000) * ain + (outTok / 1_000_000) * aout;
  }
  return estimateUsdFromIoTokens(
    workload.inputTokens,
    workload.outputTokens,
    model.inputUsdPerMtok,
    model.outputUsdPerMtok,
  );
}

export function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount < 0.01) return `₹${amount.toFixed(4)}`;
  if (amount < 1) return `₹${amount.toFixed(2)}`;
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
