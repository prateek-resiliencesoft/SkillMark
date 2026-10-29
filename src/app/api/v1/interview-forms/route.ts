import { withApiKey } from "@/lib/api-key-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appBaseUrl, serializeFormSchema, type FormRow } from "@/server/integrations/applications";

export async function GET(request: Request) {
  return withApiKey(request, "forms:read", async (auth) => {
    const status = new URL(request.url).searchParams.get("status");
    let q = supabaseAdmin.from("interview_forms").select("*").eq("organizationId", auth.organizationId).order("updatedAt", { ascending: false }).limit(100);
    if (status && ["draft", "published", "unpublished"].includes(status)) q = q.eq("status", status);
    const { data } = await q;
    const base = appBaseUrl(request);
    const rows = ((data ?? []) as FormRow[]).filter((f) => !f.projectId || auth.projectIds.includes(f.projectId));
    return Response.json({ data: rows.map((f) => serializeFormSchema(f, base)) });
  });
}
