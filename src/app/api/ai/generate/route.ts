import { getAuthUser } from "@/lib/auth";
import { aiOrgAccessResponse, authorizeAiOrg } from "@/lib/ai/org-access";
import { resolveTaskModels } from "@/lib/ai/registry";
import { questionSetSse, runQuestionSetFlow } from "@/lib/ai/flows/question-set";
import { buildGeneratorPrompt } from "@/lib/ai/prompts/generator";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ai/generate");

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const {
    description,
    durationMinutes,
    language,
    jobDescription,
    resumeText,
    premadeQuestions,
    organizationId,
    projectId,
  } = await req.json();
  if (!description) {
    return new Response(JSON.stringify({ error: "Description is required" }), { status: 400 });
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
  const messages = buildGeneratorPrompt(
    description,
    durationMinutes,
    language,
    jobDescription,
    resumeText,
    premadeQuestions,
  );

  return questionSetSse(
    (emit, signal) =>
      runQuestionSetFlow({
        mode: "generate",
        messages,
        provider,
        model: generatorModel,
        jobDescription,
        resumeText,
        premadeQuestions,
        language,
        organizationId: orgId,
        userId: user.id,
        projectId: typeof projectId === "string" ? projectId : null,
        emit,
        signal,
      }),
    (error) => {
      log.error("Interview generation error:", error);
      return "Failed to generate interview";
    },
  );
}
