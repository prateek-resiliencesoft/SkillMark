import { getAuthUser } from "@/lib/auth";
import { aiOrgAccessResponse, authorizeAiOrg } from "@/lib/ai/org-access";
import { resolveTaskModels } from "@/lib/ai/registry";
import { questionSetSse, runQuestionSetFlow } from "@/lib/ai/flows/question-set";
import { buildImprovePrompt } from "@/lib/ai/prompts/generator";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ai/refine");

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { interview, feedback, language, jobDescription, resumeText, organizationId, projectId } = await req.json();
  if (!interview || !feedback) {
    return new Response(JSON.stringify({ error: "Interview and feedback are required" }), { status: 400 });
  }

  let orgId: string | undefined;
  try {
    orgId = await authorizeAiOrg(supabaseAdmin, user.id, organizationId);
  } catch (err) {
    const denied = aiOrgAccessResponse(err);
    if (denied) return denied;
    throw err;
  }

  const { provider, generatorModel } = await resolveTaskModels(orgId, "generate");
  const messages = buildImprovePrompt(interview, feedback, language, jobDescription, resumeText);

  return questionSetSse(
    (emit, signal) =>
      runQuestionSetFlow({
        mode: "refine",
        messages,
        provider,
        model: generatorModel,
        jobDescription,
        resumeText,
        language,
        organizationId: orgId,
        userId: user.id,
        projectId: typeof projectId === "string" ? projectId : null,
        emit,
        signal,
      }),
    (error) => {
      log.error("Interview refinement error:", error);
      return "Failed to refine interview";
    },
  );
}
