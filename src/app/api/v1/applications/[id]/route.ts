import { apiError, withApiKey } from "@/lib/api-key-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appBaseUrl, loadApplicationContext, serializeApplication } from "@/server/integrations/applications";

/** Application status, interview link, answers, signed file URLs and results when done. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return withApiKey(request, "applications:read", async (auth) => {
    if (!/^app_[a-z0-9]{8,40}$/.test(params.id)) return apiError("NOT_FOUND", "Application not found", 404);
    const { data: app } = await supabaseAdmin.from("applications").select("*").eq("publicId", params.id).maybeSingle();
    if (!app) return apiError("NOT_FOUND", "Application not found", 404);
    if (app.organizationId !== auth.organizationId) return apiError("FORBIDDEN", "This API key cannot access this application", 403);
    const { data: form } = await supabaseAdmin.from("interview_forms").select("publicId, name, projectId").eq("id", app.formId).single();
    if (form?.projectId && !auth.projectIds.includes(form.projectId)) return apiError("FORBIDDEN", "This API key cannot access this application", 403);
    const { candidate, session } = await loadApplicationContext(app);
    return Response.json({ data: await serializeApplication(app, form!, candidate, session, appBaseUrl(request), true) });
  });
}
