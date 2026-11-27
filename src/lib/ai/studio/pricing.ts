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
  const inn = model.inputUsdPerMtok;
  const out = model.outputUsdPerMtok;
  if (inn == null || out == null) return null;
  return (workload.inputTokens / 1_000_000) * inn + (workload.outputTokens / 1_000_000) * out;
}

export function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount < 0.01) return `₹${amount.toFixed(4)}`;
  if (amount < 1) return `₹${amount.toFixed(2)}`;
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
