import type { Context } from "@/server/context";

type Db = Context["supabase"];

type Target =
  | { ok: true; interviewId?: string; batchId?: string }
  | { ok: false; status: 403 | 400; error: string };

/** Only ACTIVE organizations may ingest candidates (paused / removed orgs are blocked). */
export async function orgAcceptsInbound(supabase: Db, orgId: string): Promise<boolean> {
  const { data: org } = await supabase
    .from("organizations")
    .select("status")
    .eq("id", orgId)
    .maybeSingle();
  return !!org && ((org.status as string | null) ?? "ACTIVE") === "ACTIVE";
}

async function batchOrgId(supabase: Db, batchId: string): Promise<string | null> {
  const { data } = await supabase
    .from("interview_batches")
    .select("id, project:projects!inner(organizationId)")
    .eq("id", batchId)
    .maybeSingle();
  const project = (data as unknown as { project?: { organizationId?: string } } | null)?.project;
  return project?.organizationId ?? null;
}

/**
 * Resolve the interview / batch selectors from the producer payload. Every id
 * must belong to `orgId`, and a supplied batch must match the interview's batch.
 */
export async function resolveInboundTarget(
  supabase: Db,
  orgId: string,
  selectors: { interviewId?: string; batchId?: string },
): Promise<Target> {
  let { interviewId, batchId } = selectors;

  if (batchId && (await batchOrgId(supabase, batchId)) !== orgId) {
    return { ok: false, status: 403, error: "Batch not found or does not belong to your organization" };
  }

  if (interviewId) {
    const { data: iv } = await supabase
      .from("interviews")
      .select("id, batchId, project:projects!inner(organizationId)")
      .eq("id", interviewId)
      .maybeSingle();

    const ivProject = (iv as unknown as { project?: { organizationId?: string } } | null)?.project;
    if (!iv || ivProject?.organizationId !== orgId) {
      return { ok: false, status: 403, error: "Interview not found or does not belong to your organization" };
    }
    const ivBatchId = (iv.batchId as string | null) ?? undefined;
    if (batchId && ivBatchId && ivBatchId !== batchId) {
      return { ok: false, status: 400, error: "batchId does not match the interview's batch" };
    }
    if (!batchId && ivBatchId) batchId = ivBatchId;
  } else if (batchId) {
    const { data: iv } = await supabase
      .from("interviews")
      .select("id, project:projects!inner(organizationId)")
      .eq("batchId", batchId)
      .limit(1)
      .maybeSingle();

    const ivProject = (iv as unknown as { project?: { organizationId?: string } } | null)?.project;
    if (!iv || ivProject?.organizationId !== orgId) {
      return { ok: false, status: 403, error: "Batch not found or does not belong to your organization" };
    }
    interviewId = iv.id as string;
  }

  return { ok: true, interviewId, batchId };
}
