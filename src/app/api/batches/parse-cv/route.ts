import { getAuthUser } from "@/lib/auth";
import { extractCandidateProfile } from "@/lib/documents/cv-profile";
import { extractDocument, MAX_DOCUMENT_BYTES } from "@/lib/documents/extract";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/batches/parse-cv");

export const maxDuration = 120;

/** One CV per request so the client controls concurrency and shows per-file progress. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const defaultCountryCode = (form.get("defaultCountryCode") as string | null)?.trim() || undefined;
  if (!(file instanceof File)) return Response.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: `File is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await extractDocument(buffer, file.name, file.type);
    if (!doc.markdown.trim()) {
      return Response.json(
        { error: doc.warnings[0] ?? "No readable text found in this document", warnings: doc.warnings },
        { status: 422 },
      );
    }

    const { profile, reviewFlags } = await extractCandidateProfile(doc.markdown, { defaultCountryCode });
    for (const w of doc.warnings) reviewFlags.push({ field: "document", reason: w });

    return Response.json({
      fileName: file.name,
      extraction: { method: doc.method, pages: doc.pages },
      markdown: doc.markdown.slice(0, 60_000),
      profile,
      reviewFlags,
    });
  } catch (err) {
    log.error(`Failed to parse ${file.name}:`, err);
    return Response.json({ error: err instanceof Error ? err.message : "Failed to parse CV" }, { status: 500 });
  }
}
