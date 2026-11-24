import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadBugTriageSettings } from "./settings";

const log = createLogger("bug-triage/chat");

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export async function bugTriageChat(messages: ChatMessage[]): Promise<{ reply: string }> {
  const settings = await loadBugTriageSettings();
  const { data: buckets } = await supabaseAdmin
    .from("bug_buckets")
    .select("bugKey, title, severity, summary, githubIssueUrl, updatedAt")
    .order("updatedAt", { ascending: false })
    .limit(25);

  const context = {
    settings,
    buckets: buckets ?? [],
  };

  const system = `You are the SkillMark superadmin bug-triage copilot.
Answer questions about recurring bugs, severity, thresholds, and GitHub issues using ONLY the JSON context.
Be concise. If unknown, say so. Do not invent issue numbers.
Context JSON:\n${JSON.stringify(context).slice(0, 12000)}`;

  const trimmed = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));

  try {
    const { provider, generatorModel } = await resolveTaskModels(null, "generate");
    const res = await provider.generateResponse({
      messages: [{ role: "system", content: system }, ...trimmed],
      model: generatorModel,
      temperature: 0.3,
      maxTokens: 800,
    });
    const reply = (res.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!reply) throw new Error("empty reply");
    return { reply: reply.slice(0, 6000) };
  } catch (err) {
    log.warn("chat failed", err);
    return {
      reply:
        "AI chat unavailable right now (no provider or model error). Check env AI keys. You can still use the Buckets and Settings tabs.",
    };
  }
}
