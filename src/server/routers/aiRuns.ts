import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { langfuseTraceUrl } from "@/lib/ai/tracing";
import type { AiFlow, AiRunView, ReasoningStep } from "@/lib/ai/graph/types";
import { loadRoundAccess } from "../round-two/access";
import { getOrgMembership, hasMinRole, hasProjectAccess, protectedProcedure, router } from "../trpc";
import type { Context } from "../context";

const FLOWS = ["question-generation", "question-refine", "round2-plan", "round2-copilot", "round2-report", "round1-summary"] as const;

/** Org id the subject belongs to, after checking the caller may read it. */
async function authorizeSubject(ctx: Context & { user: { id: string } }, type: "round_two" | "session", id: string): Promise<string> {
  if (type === "round_two") {
    const access = await loadRoundAccess(ctx.supabase, id, ctx.user.id);
    return access.round.organizationId;
  }
  const { data } = await ctx.supabase
    .from("sessions")
    .select("id, interview:interviews!inner(projectId, project:projects!inner(organizationId))")
    .eq("id", id)
    .maybeSingle();
  const interview = data?.interview as { projectId?: string; project?: { organizationId?: string } } | undefined;
  const orgId = interview?.project?.organizationId;
  const projectId = interview?.projectId;
  if (!orgId || !projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  const membership = await getOrgMembership(ctx.supabase, orgId, ctx.user.id);
  if (!membership || !(await hasProjectAccess(ctx.supabase, projectId, ctx.user.id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this session" });
  }
  return orgId;
}

export const aiRunsRouter = router({
  /** Reasoning timelines for a round 2 or a round 1 session, newest first. */
  forSubject: protectedProcedure
    .input(
      z.object({
        subjectType: z.enum(["round_two", "session"]),
        subjectId: z.string().min(1).max(64),
        flows: z.array(z.enum(FLOWS)).max(FLOWS.length).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ runs: AiRunView[]; canSeeTraces: boolean }> => {
      const orgId = await authorizeSubject(ctx, input.subjectType, input.subjectId);
      const membership = await getOrgMembership(ctx.supabase, orgId, ctx.user.id);
      const canSeeTraces = !!membership && hasMinRole(membership.role, "ADMIN");

      let q = ctx.supabase
        .from("ai_runs")
        .select('id, flow, status, steps, tokens, error, "traceId", "startedAt", "endedAt"')
        .eq("subjectType", input.subjectType)
        .eq("subjectId", input.subjectId)
        .order("startedAt", { ascending: false })
        .limit(input.limit);
      if (input.flows?.length) q = q.in("flow", input.flows);
      const { data, error } = await q;
      if (error) return { runs: [], canSeeTraces };

      return {
        canSeeTraces,
        runs: (data ?? []).map((r) => ({
          id: r.id as string,
          flow: r.flow as AiFlow,
          status: r.status as AiRunView["status"],
          steps: (r.steps as ReasoningStep[]) ?? [],
          tokens: (r.tokens as number) ?? 0,
          error: (r.error as string | null) ?? null,
          startedAt: r.startedAt as string,
          endedAt: (r.endedAt as string | null) ?? null,
          traceUrl: canSeeTraces ? langfuseTraceUrl(r.traceId as string | null) : null,
        })),
      };
    }),
});
