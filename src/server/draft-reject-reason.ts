import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import {
  DRAFT_REJECT_REASON_MAX,
  buildDraftRejectReasonPrompt,
  fallbackDraftRejectReason,
  parseDraftRejectReasonInput,
} from "@/lib/draft-reject-reason";
import { createLogger } from "@/lib/logger";

const log = createLogger("draft-reject-reason");

export type DraftRejectReasonResult = {
  reason: string;
  /** True when org AI keys failed and a local tag/draft template was used. */
  usedFallback: boolean;
};

export async function draftRejectReason(opts: {
  organizationId: string;
  draft?: string;
  tags?: string[];
}): Promise<DraftRejectReasonResult> {
  const { draft, tags } = parseDraftRejectReasonInput(opts);
  const prompt = buildDraftRejectReasonPrompt(draft, tags);
  try {
    // Uses Settings → AI "Question generation" provider priority (generate task).
    const { provider, generatorModel } = await resolveTaskModels(opts.organizationId, "generate");
    const res = await provider.generateResponse({
      messages: [{ role: "user", content: prompt }],
      model: generatorModel,
      temperature: 0.4,
      maxTokens: 256,
    });
    const text = (res.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, DRAFT_REJECT_REASON_MAX);
    if (!text) throw new Error("AI returned an empty reason");
    return { reason: text, usedFallback: false };
  } catch (err) {
    log.warn("draftRejectReason AI failed — using local fallback", err);
    return {
      reason: fallbackDraftRejectReason(draft, tags),
      usedFallback: true,
    };
  }
}
