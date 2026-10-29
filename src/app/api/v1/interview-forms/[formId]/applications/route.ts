/* eslint-disable @typescript-eslint/no-explicit-any */
import { apiError, withApiKey } from "@/lib/api-key-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appBaseUrl,
  clientIp,
  createApplication,
  parseSubmissionRequest,
  serializeApplication,
  submissionErrorResponse,
} from "@/server/integrations/applications";
import { resolveFormForKey } from "@/server/integrations/form-access";

export const runtime = "nodejs";

/** Submit a candidate application (JSON or multipart/form-data). */
export async function POST(request: Request, { params }: { params: { formId: string } }) {
  return withApiKey(request, "applications:write", async (auth) => {
    const form = await resolveFormForKey(params.formId, auth);
    if (form instanceof Response) return form;
    try {
      const input = await parseSubmissionRequest(request);
      const app = await createApplication({
        form,
        input,
        source: "api",
        apiKeyId: auth.apiKeyId,
        environment: auth.environment,
        ip: clientIp(request),
        baseUrl: appBaseUrl(request),
      });
      return Response.json({ data: app }, { status: 201 });
    } catch (err) {
      return submissionErrorResponse(err);
    }
  });
}

/** List applications for a form (newest first). */
export async function GET(request: Request, { params }: { params: { formId: string } }) {
  return withApiKey(request, "applications:read", async (auth) => {
    const form = await resolveFormForKey(params.formId, auth);
    if (form instanceof Response) return form;
    const url = new URL(request.url);
    let limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);
    const { data, error } = await supabaseAdmin
      .from("applications")
      .select("*, candidate:candidates(inviteToken, sessionId, session:sessions(id, status))")
      .eq("formId", form.id)
      .eq("organizationId", auth.organizationId)
      .order("createdAt", { ascending: false })
      .limit(limit);
    if (error) return apiError("INTERNAL_ERROR", "Failed to list applications", 500);
    const base = appBaseUrl(request);
    const out = await Promise.all(
      (data ?? []).map((a: any) => serializeApplication(a, form, a.candidate ?? null, a.candidate?.session ?? null, base, false)),
    );
    return Response.json({ data: out });
  });
}
