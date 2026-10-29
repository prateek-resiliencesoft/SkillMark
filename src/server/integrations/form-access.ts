import { apiError, type ApiKeyAuth } from "@/lib/api-key-auth";
import { getFormByPublicId, type FormRow } from "@/server/integrations/applications";

/** Resolve a form by public id and enforce tenant isolation for an API key. */
export async function resolveFormForKey(publicId: string, auth: ApiKeyAuth): Promise<FormRow | Response> {
  const form = await getFormByPublicId(publicId);
  if (!form) return apiError("NOT_FOUND", "Form not found", 404);
  if (form.organizationId !== auth.organizationId || (form.projectId && !auth.projectIds.includes(form.projectId))) {
    return apiError("FORBIDDEN", "This API key cannot access this form", 403);
  }
  return form;
}
