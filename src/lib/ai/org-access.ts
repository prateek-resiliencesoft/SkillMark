import { TRPCError } from "@trpc/server";
import type { Context } from "@/server/context";
import { requireOrgAccess, type MemberRole } from "@/server/tenant";

export class AiOrgAccessError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
    this.name = "AiOrgAccessError";
  }
}

/**
 * Org whose AI credentials a request may spend. A caller-supplied organizationId is only
 * honored when the caller is an active member with at least `minRole`; otherwise this
 * throws, so callers never resolve another tenant's keys. No organizationId → undefined
 * (platform defaults).
 */
export async function authorizeAiOrg(
  db: Context["supabase"],
  userId: string,
  organizationId: unknown,
  minRole: MemberRole = "MEMBER",
): Promise<string | undefined> {
  if (organizationId === undefined || organizationId === null || organizationId === "") return undefined;
  if (typeof organizationId !== "string" || organizationId.length > 64) {
    throw new AiOrgAccessError("Invalid organizationId", 400);
  }
  try {
    await requireOrgAccess(db, organizationId, userId, { minRole });
  } catch (err) {
    if (err instanceof TRPCError) throw new AiOrgAccessError("You don't have access to this organization", 403);
    throw err;
  }
  return organizationId;
}

export function aiOrgAccessResponse(err: unknown): Response | null {
  if (!(err instanceof AiOrgAccessError)) return null;
  return Response.json({ error: err.message }, { status: err.status });
}
