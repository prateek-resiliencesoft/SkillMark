import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import {
  getEffectiveProjectRole,
  getOrgMembership,
  hasProjectAccess,
  type MemberRole,
} from "./trpc";
import type { Context } from "./context";

type Db = Context["supabase"];

/** Resolves the caller's effective role on a project, or throws. */
export async function verifyProjectAccess(
  supabase: Db,
  projectId: string,
  userId: string,
): Promise<{ role: MemberRole; organizationId: string }> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, organizationId")
    .eq("id", projectId)
    .single();
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const membership = await getOrgMembership(supabase, project.organizationId, userId);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  }
  if (!(await hasProjectAccess(supabase, projectId, userId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
  }
  const role = await getEffectiveProjectRole(supabase, projectId, userId, membership.role);
  return { role, organizationId: project.organizationId };
}

export async function verifyBatchAccess(supabase: Db, batchId: string, userId: string) {
  const { data: batch } = await supabase
    .from("interview_batches")
    .select("*")
    .eq("id", batchId)
    .single();
  if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
  const access = await verifyProjectAccess(supabase, batch.projectId, userId);
  return { batch, ...access };
}

export async function resolveDefaultProjectId(supabase: Db, userId: string): Promise<string> {
  const { data: membership } = await supabase
    .from("organization_members")
    .select("workspaceId")
    .eq("userId", userId)
    .limit(1)
    .single();
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "No organization found" });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("organizationId", membership.workspaceId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .single();
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "No project found. Create a project first." });
  return project.id;
}

/** Public base URL for invite links (env first, then the request's origin). */
export function appBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  try {
    const h = headers();
    const origin = h.get("origin");
    if (origin) return origin.replace(/\/$/, "");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  } catch {
    /* outside a request */
  }
  return "http://localhost:3100";
}

export const inviteLink = (token: string) => `${appBaseUrl()}/i/invite/${token}`;
