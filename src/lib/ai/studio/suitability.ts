import type { AiProviderId, AiTaskKind } from "@/lib/ai/credentials";
import { isSttProvider } from "@/lib/ai/credentials";
import { isVoiceCapableProvider } from "@/lib/ai/capabilities";
import {
  estimateWorkloadUsd,
  type PriceableModel,
  type WorkloadEstimate,
} from "./pricing";

export type CatalogModel = PriceableModel & {
  provider: AiProviderId;
  modelId: string;
  displayName?: string | null;
  description?: string | null;
  qualityTier?: number | null;
  suitableTasks?: string[] | null;
  modalities?: string[] | null;
};

export type RankedModel = CatalogModel & {
  estimateUsd: number | null;
  rankLabel: "cheap" | "balanced" | "best" | "other";
};

function hardCapable(task: AiTaskKind, provider: AiProviderId): boolean {
  if (task === "voice") return isVoiceCapableProvider(provider);
  if (task === "round2_transcript") return isSttProvider(provider);
  return true;
}

function softSuitable(model: CatalogModel, task: AiTaskKind): boolean {
  if (!hardCapable(task, model.provider)) return false;
  const tasks = model.suitableTasks;
  if (!tasks?.length) return true; // unknown allow-list → keep, rank lower via missing price
  return tasks.includes(task);
}

/**
 * Filter models for a section, sort cheap→expensive (nulls last), then attach
 * cheap / balanced / best labels on three representatives.
 */
export function rankModelsForTask(
  models: CatalogModel[],
  task: AiTaskKind,
  workload: WorkloadEstimate,
): RankedModel[] {
  const filtered = models.filter((m) => softSuitable(m, task)).map((m) => ({
    ...m,
    estimateUsd: estimateWorkloadUsd(m, workload),
    rankLabel: "other" as RankedModel["rankLabel"],
  }));

  filtered.sort((a, b) => {
    const ae = a.estimateUsd;
    const be = b.estimateUsd;
    if (ae == null && be == null) {
      return (b.qualityTier ?? 0) - (a.qualityTier ?? 0);
    }
    if (ae == null) return 1;
    if (be == null) return -1;
    if (ae !== be) return ae - be;
    return (b.qualityTier ?? 0) - (a.qualityTier ?? 0);
  });

  if (!filtered.length) return filtered;

  const priced = filtered.filter((m) => m.estimateUsd != null);
  const pickCheap = priced[0] ?? filtered[0];
  const pickBest = [...filtered].sort((a, b) => (b.qualityTier ?? 0) - (a.qualityTier ?? 0))[0];
  const mid = priced[Math.floor((priced.length - 1) / 2)] ?? filtered[Math.floor(filtered.length / 2)];

  for (const m of filtered) {
    if (m.modelId === pickCheap.modelId && m.provider === pickCheap.provider) m.rankLabel = "cheap";
    else if (m.modelId === pickBest.modelId && m.provider === pickBest.provider) m.rankLabel = "best";
    else if (m.modelId === mid.modelId && m.provider === mid.provider) m.rankLabel = "balanced";
  }
  // If cheap === best, keep "best" preference on that single model.
  if (
    pickCheap.provider === pickBest.provider &&
    pickCheap.modelId === pickBest.modelId
  ) {
    pickCheap.rankLabel = "best";
  }

  return filtered;
}

/** Three suggestion chips: cheap, balanced, best (deduped). */
export function suggestionStrip(ranked: RankedModel[]): RankedModel[] {
  const order: RankedModel["rankLabel"][] = ["cheap", "balanced", "best"];
  const out: RankedModel[] = [];
  for (const label of order) {
    const hit = ranked.find((m) => m.rankLabel === label);
    if (hit && !out.some((x) => x.provider === hit.provider && x.modelId === hit.modelId)) {
      out.push(hit);
    }
  }
  return out;
}
