import { withApiKey } from "@/lib/api-key-auth";
import { appBaseUrl, serializeFormSchema } from "@/server/integrations/applications";
import { resolveFormForKey } from "@/server/integrations/form-access";

export async function GET(request: Request, { params }: { params: { formId: string } }) {
  return withApiKey(request, "forms:read", async (auth) => {
    const form = await resolveFormForKey(params.formId, auth);
    if (form instanceof Response) return form;
    return Response.json({ data: serializeFormSchema(form, appBaseUrl(request)) });
  });
}
