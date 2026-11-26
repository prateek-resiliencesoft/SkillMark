import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import {
  getEffectiveProjectRole,
  getOrgMembership,
  hasMinRole,
  hasProjectAccess,
  type MemberRole,
} from "./trpc";
import type { Context } from "./context";

type Db = Context["supabase"];

/**
 * Resolves the caller's effective role on a project, or throws.
 * `write` blocks paused organizations.
 */
export async function verifyProjectAccess(
  supabase: Db,
  projectId: string,
  userId: string,
  options: { write?: boolean } = {},
): Promise<{ role: MemberRole; organizationId: string }> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, organizationId")
    .eq("id", projectId)
    .single();
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const membership = await getOrgMembership(supabase, project.organizationId, userId, options);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  }
  if (!(await hasProjectAccess(supabase, projectId, userId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
  }
  const role = await getEffectiveProjectRole(supabase, projectId, userId, membership.role);
  return { role, organizationId: project.organizationId };
}

export async function verifyBatchAccess(
  supabase: Db,
  batchId: string,
  userId: string,
  options: { write?: boolean } = {},
) {
  const { data: batch } = await supabase
    .from("interview_batches")
    .select("*")
    .eq("id", batchId)
    .single();
  if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
  const access = await verifyProjectAccess(supabase, batch.projectId, userId, options);
  return { batch, ...access };
}

/**
 * Authorize a CV upload for a batch candidate: write access (MEMBER+) on the
 * candidate's project in an active organization. Returns an HTTP status on failure.
 */
export async function authorizeCandidateCvUpload(
  supabase: Db,
  candidateId: string,
  userId: string,
): Promise<
  | { ok: true; candidate: { id: string; name: string; email: string | null; profile: unknown }; orgId: string; projectId: string }
  | { ok: false; status: 403 | 404; error: string }
> {
  const { data: candidate } = await supabase
    .from("candidates")
    .select(
      "id, name, email, profile, interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))",
    )
    .eq("id", candidateId)
    .maybeSingle();
  if (!candidate) return { ok: false, status: 404, error: "Candidate not found" };

  const interview = candidate.interview as unknown as {
    projectId: string;
    project: { organizationId: string };
  };
  try {
    const { role, organizationId } = await verifyProjectAccess(
      supabase,
      interview.projectId,
      userId,
      { write: true },
    );
    if (!hasMinRole(role, "MEMBER")) return { ok: false, status: 403, error: "Forbidden" };
    return {
      ok: true,
      candidate: {
        id: candidate.id as string,
        name: candidate.name as string,
        email: (candidate.email as string | null) ?? null,
        profile: candidate.profile,
      },
      orgId: organizationId,
      projectId: interview.projectId,
    };
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      return { ok: false, status: 404, error: "Candidate not found" };
    }
    if (err instanceof TRPCError) return { ok: false, status: 403, error: "Forbidden" };
    throw err;
  }
}

export async function resolveDefaultProjectId(supabase: Db, userId: string): Promise<string> {
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organizationId")
    .eq("userId", userId)
    .limit(1)
    .single();
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "No organization found" });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("organizationId", membership.organizationId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .single();
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No project found. Create a project first." });
  return project.id;
}

/** Public base URL for invite links (env first, then the request's origin). */
export function appBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host && (!env || env.includes("localhost") || env.includes("127.0.0.1"))) {
      return `${proto}://${host}`;
    }
    const origin = h.get("origin");
    if (origin && (!env || env.includes("localhost") || env.includes("127.0.0.1"))) {
      return origin.replace(/\/$/, "");
    }
  } catch {
    /* outside a request */
  }
  if (env) return env;
  return "http://localhost:3000";
}

export const inviteLink = (token: string) => `${appBaseUrl()}/i/invite/${token}`;

/** Dashboard deep-link to a candidate's report (results tab + session). */
export const sessionReportLink = (interviewId: string, sessionId: string) =>
  `${appBaseUrl()}/interviews/${interviewId}/results?session=${sessionId}`;
