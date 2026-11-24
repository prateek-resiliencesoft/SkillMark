import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import {
  buildDraftRejectReasonPrompt,
  fallbackDraftRejectReason,
  finalizeDraftRejectReason,
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
      temperature: 0.35,
      // Thinking models burn tokens before visible text; 256 was cutting mid-sentence.
      maxTokens: 700,
    });
    let text = finalizeDraftRejectReason(res.content ?? "");
    let usedFallback = false;
    // Too short / still truncated → local polite template (never ship a fragment).
    if (text.length < 80 || !/[.!?]$/.test(text)) {
      const fb = fallbackDraftRejectReason(text || draft, tags);
      if (fb.length >= 80) {
        text = fb;
        usedFallback = true;
      }
    }
    if (!text) throw new Error("AI returned an empty reason");
    return { reason: text, usedFallback };
  } catch (err) {
    log.warn("draftRejectReason AI failed — using local fallback", err);
    return {
      reason: fallbackDraftRejectReason(draft, tags),
      usedFallback: true,
    };
  }
}
