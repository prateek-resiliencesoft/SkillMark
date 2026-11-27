import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import {
  buildEnhanceFeedbackPrompt,
  fallbackEnhanceFeedback,
  finalizeEnhanceFeedback,
  parseEnhanceFeedbackInput,
} from "@/lib/draft-candidate-feedback";
import { createLogger } from "@/lib/logger";

const log = createLogger("draft-candidate-feedback");

export type EnhanceCandidateFeedbackResult = {
  comment: string;
  usedFallback: boolean;
};

export async function enhanceCandidateFeedback(opts: {
  organizationId: string;
  draft: string;
}): Promise<EnhanceCandidateFeedbackResult> {
  const { draft } = parseEnhanceFeedbackInput({ draft: opts.draft });
  const prompt = buildEnhanceFeedbackPrompt(draft);
  try {
    const { provider, generatorModel } = await resolveTaskModels(opts.organizationId, "generate");
    const res = await provider.generateResponse({
      messages: [{ role: "user", content: prompt }],
      model: generatorModel,
      temperature: 0.4,
      maxTokens: 500,
    });
    let text = finalizeEnhanceFeedback(res.content ?? "");
    let usedFallback = false;
    if (text.length < 20 || !/[.!?]$/.test(text)) {
      const fb = fallbackEnhanceFeedback(text || draft);
      if (fb.length >= 20) {
        text = fb;
        usedFallback = true;
      }
    }
    if (!text) throw new Error("AI returned empty feedback");
    return { comment: text, usedFallback };
  } catch (err) {
    log.warn("enhanceCandidateFeedback AI failed — using local fallback", err);
    return {
      comment: fallbackEnhanceFeedback(draft),
      usedFallback: true,
    };
  }
}
