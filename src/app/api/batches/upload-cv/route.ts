import { getAuthUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { mediaObjectKey } from "@/lib/storage-paths";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FILES_BUCKET } from "@/server/integrations/applications";
import { getOrgMembership, hasProjectAccess } from "@/server/trpc";

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

  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select(
      "id, profile, interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))",
    )
    .eq("id", candidateId)
    .maybeSingle();

  if (!candidate) return Response.json({ error: "Candidate not found" }, { status: 404 });

  const interview = candidate.interview as unknown as {
    id: string;
    projectId: string;
    project: { id: string; organizationId: string };
  };
  const orgId = interview.project.organizationId;
  const membership = await getOrgMembership(supabaseAdmin, orgId, user.id);
  if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });
  const access = await hasProjectAccess(supabaseAdmin, interview.projectId, user.id);
  if (!access) return Response.json({ error: "Forbidden" }, { status: 403 });

  const path = mediaObjectKey({
    orgId,
    projectId: interview.projectId,
    candidateId,
    kind: "cv",
    fileName: `0-${file.name}`,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabaseAdmin.storage
    .from(FILES_BUCKET)
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (uploadError) {
    log.error("CV upload failed:", uploadError);
    return Response.json({ error: uploadError.message }, { status: 500 });
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
        cvType: file.type || "application/octet-stream",
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
