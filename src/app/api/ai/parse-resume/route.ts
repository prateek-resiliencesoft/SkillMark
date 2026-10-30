import { getAuthUser } from "@/lib/auth";
import { resolveFallbackProviders, resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { parseResumeText } from "@/lib/ai/resume-parse";

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
    const organizationId = (formData.get("organizationId") as string | null)?.trim() || undefined;
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

    // Non-streamed JSON-mode call with tolerant parsing + one strict retry; the result is
    // sent as a single SSE token so existing clients keep working.
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const fallbacks = await resolveFallbackProviders(organizationId, provider.id).catch(() => []);
          const parsed = await parseResumeText(provider, generatorModel, resumeText, {
            fallbacks,
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
