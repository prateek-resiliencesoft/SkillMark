import { budgetSignal, describeAiFailure, PARSE_CV_BUDGET_MS, raceAbort } from "@/lib/ai/fail-fast";
import { aiOrgAccessResponse, authorizeAiOrg } from "@/lib/ai/org-access";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractCandidateProfile } from "@/lib/documents/cv-profile";
import { extractDocument, MAX_DOCUMENT_BYTES } from "@/lib/documents/extract";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/batches/parse-cv");

// Must stay below the proxy's response timeout (Caddy 90s) so the client always gets JSON, not an empty 504.
export const maxDuration = 85;

/** One CV per request so the client controls concurrency and shows per-file progress. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const defaultCountryCode = (form.get("defaultCountryCode") as string | null)?.trim() || undefined;
  let organizationId: string | undefined;
  try {
    organizationId = await authorizeAiOrg(
      supabaseAdmin,
      user.id,
      (form.get("organizationId") as string | null)?.trim() || undefined,
    );
  } catch (err) {
    const denied = aiOrgAccessResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: `File is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  // Total budget for this file (extraction + profile); aborts in-flight AI calls when spent.
  const signal = budgetSignal(PARSE_CV_BUDGET_MS, req.signal);
  try {
    return await raceAbort(parseFile(file, { defaultCountryCode, organizationId, signal }), signal);
  } catch (err) {
    log.error(`Failed to parse ${file.name}:`, err);
    // Quota / auth / timeout → clear JSON message with 429 / 503 / 504.
    const info = describeAiFailure(err, signal);
    if (info) return Response.json({ error: info.error, code: info.code, fileName: file.name }, { status: info.status });
    const message = err instanceof Error ? err.message : "Failed to parse CV";
    const status = (err as { status?: number } | null)?.status;
    // Surface provider 400s as 502 so the client always gets a JSON body with a clear message.
    return Response.json(
      { error: message, fileName: file.name },
      { status: status === 401 || status === 403 ? status : 502 },
    );
  }
}

async function parseFile(
  file: File,
  opts: { defaultCountryCode?: string; organizationId?: string; signal: AbortSignal },
): Promise<Response> {
  const { defaultCountryCode, organizationId, signal } = opts;
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await extractDocument(buffer, file.name, file.type, { organizationId, signal });
  if (!doc.markdown.trim()) {
    return Response.json(
      { error: doc.warnings[0] ?? "No readable text found in this document", warnings: doc.warnings },
      { status: 422 },
    );
  }

  const { profile, reviewFlags } = await extractCandidateProfile(doc.markdown, {
    defaultCountryCode,
    organizationId,
    signal,
  });
  for (const w of doc.warnings) reviewFlags.push({ field: "document", reason: w });

  return Response.json({
    fileName: file.name,
    extraction: { method: doc.method, pages: doc.pages },
    markdown: doc.markdown.slice(0, 60_000),
    profile,
    reviewFlags,
  });
}
