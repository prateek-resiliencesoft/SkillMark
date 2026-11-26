import { getAuthUser } from "@/lib/auth";
import { canonicalMimeForDetected, normaliseDetected, sniffFileType } from "@/lib/forms/schema";
import { createLogger } from "@/lib/logger";
import { isStorageCapError } from "@/lib/storage-cap";
import { cvObjectName, mediaObjectKey } from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FILES_BUCKET } from "@/server/integrations/applications";
import { authorizeCandidateCvUpload } from "@/server/batch-access";

const log = createLogger("api/batches/upload-cv");
const MAX_BYTES = 20 * 1024 * 1024;

/** Persist the original CV file for a batch-generated candidate. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const candidateId = (form.get("candidateId") as string | null)?.trim();
  if (!(file instanceof File) || !candidateId) {
    return Response.json({ error: "file and candidateId required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File too large (max 20MB)" }, { status: 413 });
  }

  const auth = await authorizeCandidateCvUpload(supabaseAdmin, candidateId, user.id);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const { candidate, orgId, projectId } = auth;

  const path = mediaObjectKey({
    orgId,
    projectId,
    candidateId,
    candidateName: candidate.name,
    candidateEmail: candidate.email as string | null,
    kind: "CV",
    fileName: cvObjectName(candidateId, file.name),
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = canonicalMimeForDetected(
    normaliseDetected(sniffFileType(new Uint8Array(buffer)), file.name),
  );
  const { error: uploadError } = await supabaseAdmin.storage
    .from(FILES_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });
  if (uploadError) {
    log.error("CV upload failed:", uploadError);
    return Response.json({ error: uploadError.message }, { status: isStorageCapError(uploadError.message) ? 507 : 500 });
  }

  const prev =
    candidate.profile && typeof candidate.profile === "object"
      ? (candidate.profile as Record<string, unknown>)
      : {};
  const { error: updateError } = await supabaseAdmin
    .from("candidates")
    .update({
      profile: {
        ...prev,
        fileName: file.name,
        cvPath: path,
        cvType: contentType,
        cvSize: file.size,
      },
    })
    .eq("id", candidateId);

  if (updateError) {
    log.error("profile update failed:", updateError);
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({ path, name: file.name });
}
