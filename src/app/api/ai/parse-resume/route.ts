import { getAuthUser } from "@/lib/auth";
import { resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { parseResumeText } from "@/lib/ai/resume-parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Org whose AI keys to use: the requested org (if the user is a member), else the
 * interview's org, else the user's first org with saved AI keys. Never another org's keys.
 */
async function resolveOrgForUser(userId: string, requested?: string, interviewId?: string): Promise<string | undefined> {
  const { data: memberships } = await supabaseAdmin
    .from("organization_members")
    .select("organizationId")
    .eq("userId", userId);
  const mine = new Set((memberships ?? []).map((m: { organizationId: string }) => m.organizationId));
  if (requested && mine.has(requested)) return requested;
  if (interviewId) {
    const { data: iv } = await supabaseAdmin
      .from("interviews")
      .select("project:projects(organizationId)")
      .eq("id", interviewId)
      .maybeSingle();
    const orgId = (iv?.project as { organizationId?: string } | null)?.organizationId;
    if (orgId && mine.has(orgId)) return orgId;
  }
  if (mine.size) {
    const { data: rows } = await supabaseAdmin
      .from("org_integrations")
      .select("organizationId, aiProviders")
      .in("organizationId", [...mine]);
    const withKeys = (rows ?? []).find((r: { aiProviders: unknown }) => r.aiProviders && Object.keys(r.aiProviders as object).length);
    if (withKeys) return withKeys.organizationId as string;
  }
  return undefined;
}

const log = createLogger("api/ai/parse-resume");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string }>;



export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const requestedOrgId = (formData.get("organizationId") as string | null)?.trim() || undefined;
    const interviewId = (formData.get("interviewId") as string | null)?.trim() || undefined;
    const organizationId = await resolveOrgForUser(user.id, requestedOrgId, interviewId);
    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Extract text locally using pdf-parse (preserves emails reliably)
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buffer);
    const resumeText = pdfData.text?.trim();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Could not extract text from the PDF." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { provider, generatorModel } = await resolveTaskModels(organizationId);
    log.info(`Resume parse for user ${user.id.slice(0, 8)} using org ${organizationId?.slice(0, 8) ?? "none (env keys)"}`);

    // Non-streamed JSON-mode call with tolerant parsing + one strict retry; the result is
    // sent as a single SSE token so existing clients keep working.
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const parsed = await parseResumeText(provider, generatorModel, resumeText, {
            onStatus: (status) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status })}\n\n`)),
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: JSON.stringify(parsed) })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          log.error("Resume parse failed:", err instanceof Error ? err.message : err);
          const msg = err instanceof Error ? err.message : "Resume parse failed";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log.error("Error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
