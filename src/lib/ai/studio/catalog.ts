import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AiProviderId } from "@/lib/ai/credentials";
import type { CatalogModel } from "./suitability";
import { usdToInr } from "./pricing";

export type CatalogRow = CatalogModel & {
  estimateInr?: number | null;
  pricesAsOf?: string | null;
};

export async function loadUsdInr(): Promise<{ usdInr: number; asOf: string | null }> {
  const { data } = await supabaseAdmin.from("ai_price_fx").select('"usdInr", "asOf"').eq("id", 1).maybeSingle();
  const usdInr = data?.usdInr != null ? Number(data.usdInr) : 93;
  return { usdInr: Number.isFinite(usdInr) && usdInr > 0 ? usdInr : 93, asOf: data?.asOf ?? null };
}

export async function loadCatalogRows(providers?: AiProviderId[]): Promise<CatalogModel[]> {
  let q = supabaseAdmin.from("ai_model_catalog").select("*");
  if (providers?.length) q = q.in("provider", providers);
  const { data, error } = await q;
  if (error) {
    // Table may not exist yet in older deploys — return empty.
    return [];
  }
  return (data ?? []).map((row) => ({
    provider: row.provider as AiProviderId,
    modelId: row.modelId as string,
    displayName: row.displayName,
    description: row.description,
    qualityTier: row.qualityTier != null ? Number(row.qualityTier) : 3,
    suitableTasks: row.suitableTasks ?? [],
    modalities: row.modalities ?? [],
    inputUsdPerMtok: row.inputUsdPerMtok != null ? Number(row.inputUsdPerMtok) : null,
    outputUsdPerMtok: row.outputUsdPerMtok != null ? Number(row.outputUsdPerMtok) : null,
    audioInUsdPerMtok: row.audioInUsdPerMtok != null ? Number(row.audioInUsdPerMtok) : null,
    audioOutUsdPerMtok: row.audioOutUsdPerMtok != null ? Number(row.audioOutUsdPerMtok) : null,
    perMinuteUsd: row.perMinuteUsd != null ? Number(row.perMinuteUsd) : null,
  }));
}

export async function upsertListedModels(
  provider: AiProviderId,
  models: { id: string; displayName?: string }[],
): Promise<number> {
  if (!models.length) return 0;
  const rows = models.map((m) => ({
    provider,
    modelId: m.id,
    displayName: m.displayName || m.id,
    source: "list_models",
    updatedAt: new Date().toISOString(),
  }));
  const { error } = await supabaseAdmin.from("ai_model_catalog").upsert(rows, {
    onConflict: "provider,modelId",
    ignoreDuplicates: false,
  });
  if (error) return 0;
  return rows.length;
}

export function withInrEstimate(
  model: CatalogModel,
  estimateUsd: number | null,
  usdInr: number,
): CatalogRow {
  return {
    ...model,
    estimateInr: estimateUsd != null ? usdToInr(estimateUsd, usdInr) : null,
  };
}
