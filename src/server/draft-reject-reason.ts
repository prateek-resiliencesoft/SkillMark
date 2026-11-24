import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import {
  DRAFT_REJECT_REASON_MAX,
  buildDraftRejectReasonPrompt,
  parseDraftRejectReasonInput,
} from "@/lib/draft-reject-reason";
import { createLogger } from "@/lib/logger";

const log = createLogger("draft-reject-reason");

export async function draftRejectReason(opts: {
  organizationId: string;
  draft?: string;
  tags?: string[];
}): Promise<string> {
  const { draft, tags } = parseDraftRejectReasonInput(opts);
  const { provider, generatorModel } = await resolveTaskModels(opts.organizationId, "generate");
  const prompt = buildDraftRejectReasonPrompt(draft, tags);
  try {
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
    return text;
  } catch (err) {
    log.warn("draftRejectReason failed", err);
    throw err instanceof Error ? err : new Error("AI draft failed");
  }
}
