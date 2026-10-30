import { nanoid } from "@/lib/id";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    assertMinRole, filterAccessibleProjectIds,
    getEffectiveProjectRole, getOrgMembership, hasProjectAccess, protectedProcedure, publicProcedure, router, type MemberRole
} from "../trpc";
import { inviteLink } from "../batch-access";
import { deliverEmail, deliverWhatsapp, loadDeliveryConfig } from "../invite-delivery";
import { formatScheduleNotice, type TemplateVars } from "@/lib/messaging/templates";

const sendViaSchema = z.object({ email: z.boolean(), whatsapp: z.boolean() });

type ChannelResult = { status: "sent" | "failed" | "skipped"; error?: string };
export interface InviteDeliveryResult {
  email?: ChannelResult;
  whatsapp?: ChannelResult;
}

/** Send the invite link for one candidate. Never throws — errors are returned per channel. */
async function sendCandidateInvite(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  candidateId: string,
  channels: { email: boolean; whatsapp: boolean },
): Promise<InviteDeliveryResult> {
  const out: InviteDeliveryResult = {};
  if (!channels.email && !channels.whatsapp) return out;
  try {
    const { data: c } = await supabase
      .from("candidates")
      .select("id, name, email, phone, inviteToken, scheduledAt, expiresAt, interview:interviews(title, timeLimitMinutes)")
      .eq("id", candidateId)
      .single();
    if (!c || !c.inviteToken) {
      const r: ChannelResult = { status: "failed", error: "Candidate has no invite link" };
      if (channels.email) out.email = r;
      if (channels.whatsapp) out.whatsapp = r;
      return out;
    }
    const cfg = await loadDeliveryConfig(supabase, organizationId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iv = c.interview as any;
    const title = ((iv?.title as string | undefined) ?? "Interview").split(" · ")[0];
    const vars: TemplateVars = {
      name: c.name,
      interviewTitle: title,
      organization: cfg.organizationName,
      link: inviteLink(c.inviteToken),
      duration: iv?.timeLimitMinutes ? `${iv.timeLimitMinutes} minutes` : "",
      batchName: title,
      scheduledAt: (c.scheduledAt as string | null) ?? undefined,
      expiresAt: (c.expiresAt as string | null) ?? undefined,
      scheduleNotice: formatScheduleNotice(c.scheduledAt as string | null, c.expiresAt as string | null),
    };
    const update: Record<string, unknown> = {};
    const errors: string[] = [];
    if (channels.email) {
      const r = await deliverEmail(cfg, c.email, vars);
      out.email = { status: r.status, error: r.error };
      update.emailStatus = r.status;
      update.emailProvider = r.provider;
      if (r.status === "sent") update.emailSentAt = new Date().toISOString();
      if (r.error) errors.push(`Email (${r.provider}): ${r.error}`);
    }
    if (channels.whatsapp) {
      const phone = (c.phone as string | null)?.replace(/[\s()-]/g, "") || null;
      const r = await deliverWhatsapp(cfg, phone, vars);
      out.whatsapp = { status: r.status, error: r.error };
      update.whatsappStatus = r.status;
      update.whatsappProvider = r.provider ?? "resilio";
      if (r.status === "sent") update.whatsappSentAt = new Date().toISOString();
      if (r.error) errors.push(`WhatsApp: ${r.error}`);
    }
    update.lastSendError = errors.length ? errors.join(" · ").slice(0, 500) : null;
    await supabase.from("candidates").update(update).eq("id", c.id);
  } catch (err) {
    const r: ChannelResult = { status: "failed", error: err instanceof Error ? err.message : "Send failed" };
    if (channels.email && !out.email) out.email = r;
    if (channels.whatsapp && !out.whatsapp) out.whatsapp = r;
  }
  return out;
}

const candidateFields = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  notes: z.string().optional(),
  education: z.string().optional(),
  school: z.string().optional(),
  major: z.string().optional(),
  graduationYear: z.number().int().optional(),
  workExperience: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/*  Helper: verify interview access via org membership                 */
/* ------------------------------------------------------------------ */

async function verifyInterviewAccess(
  supabase: Parameters<typeof getOrgMembership>[0],
  interviewId: string,
  userId: string,
): Promise<{ role: MemberRole; interviewUserId: string; organizationId: string }> {
  const { data: interview } = await supabase
    .from("interviews")
    .select("userId, projectId, project:projects!inner(organizationId)")
    .eq("id", interviewId)
    .single();

  if (!interview) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Interview not found" });
  }

  const project = interview.project as unknown as {
    organizationId: string;
  };

  const membership = await getOrgMembership(
    supabase,
    project.organizationId,
    userId,
  );
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  }

  const projAccess = await hasProjectAccess(supabase, interview.projectId, userId);
  if (!projAccess) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
  }

  const effectiveRole = await getEffectiveProjectRole(
    supabase,
    interview.projectId,
    userId,
    membership.role,
  );

  return { role: effectiveRole, interviewUserId: interview.userId, organizationId: project.organizationId };
}

export const candidateRouter = router({
  create: protectedProcedure
    .input(
      z.object({ interviewId: z.string(), sendVia: sendViaSchema.optional() }).merge(candidateFields),
    )
    .mutation(async ({ ctx, input }) => {
      const { interviewId, sendVia, ...fields } = input;

      const { role, organizationId } = await verifyInterviewAccess(
        ctx.supabase,
        interviewId,
        ctx.user.id,
      );
      assertMinRole(role, "MEMBER");

      const inviteToken = nanoid(12);
      if (fields.email === "") fields.email = undefined;

      const { data: candidate, error } = await ctx.supabase
        .from("candidates")
        .insert({
          interviewId,
          ...fields,
          email: fields.email || null,
          inviteToken,
        })
        .select("*")
        .single();

      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      // Delivery failures never fail session creation.
      const delivery = sendVia
        ? await sendCandidateInvite(ctx.supabase, organizationId, candidate.id, sendVia)
        : {};

      return { ...candidate, delivery };
    }),

  /** Which invite channels the interview's org has configured (no secrets returned). */
  deliveryOptions: protectedProcedure
    .input(z.object({ interviewId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = await verifyInterviewAccess(ctx.supabase, input.interviewId, ctx.user.id);
      const cfg = await loadDeliveryConfig(ctx.supabase, organizationId);
      return { email: !!cfg.resend || !!cfg.brevo, whatsapp: !!cfg.resilio };
    }),

  /** Re-send the invite link of an existing session. */
  resendInvite: protectedProcedure
    .input(z.object({ candidateId: z.string(), channels: sendViaSchema }))
    .mutation(async ({ ctx, input }) => {
      const { data: c } = await ctx.supabase
        .from("candidates")
        .select("id, interviewId")
        .eq("id", input.candidateId)
        .single();
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const { role, organizationId } = await verifyInterviewAccess(ctx.supabase, c.interviewId, ctx.user.id);
      assertMinRole(role, "MEMBER");
      return sendCandidateInvite(ctx.supabase, organizationId, c.id, input.channels);
    }),

  bulkCreate: protectedProcedure
    .input(
      z.object({
        interviewId: z.string(),
        candidates: z.array(candidateFields).min(1).max(500),
        sendVia: sendViaSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { interviewId, candidates, sendVia } = input;

      const { role, organizationId } = await verifyInterviewAccess(
        ctx.supabase,
        interviewId,
        ctx.user.id,
      );
      assertMinRole(role, "MEMBER");

      const seen = new Set<string>();
      const deduped = candidates.filter((c) => {
        const email = c.email?.trim().toLowerCase();
        if (!email) return true;
        if (seen.has(email)) return false;
        seen.add(email);
        return true;
      });

      const rows = deduped.map((c) => ({
        interviewId,
        ...c,
        email: c.email?.trim().toLowerCase() || null,
        inviteToken: nanoid(12),
      }));

      if (rows.length === 0) {
        return { created: 0, total: deduped.length };
      }

      const { data, error } = await ctx.supabase
        .from("candidates")
        .insert(rows)
        .select("*");

      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      // Optional invite delivery — failures never block the import.
      const delivery = { email: { sent: 0, failed: 0 }, whatsapp: { sent: 0, failed: 0 }, errors: [] as string[] };
      if (sendVia && (sendVia.email || sendVia.whatsapp)) {
        for (const c of data ?? []) {
          const r = await sendCandidateInvite(ctx.supabase, organizationId, c.id, {
            email: sendVia.email && !!c.email,
            whatsapp: sendVia.whatsapp && !!c.phone,
          });
          for (const ch of ["email", "whatsapp"] as const) {
            const x = r[ch];
            if (!x) continue;
            if (x.status === "sent") delivery[ch].sent++;
            else {
              delivery[ch].failed++;
              if (x.error && delivery.errors.length < 5) delivery.errors.push(`${c.name} (${ch}): ${x.error}`);
            }
          }
        }
      }

      return { created: data?.length ?? 0, total: deduped.length, delivery };
    }),

  list: protectedProcedure
    .input(z.object({ interviewId: z.string() }))
    .query(async ({ ctx, input }) => {
      await verifyInterviewAccess(ctx.supabase, input.interviewId, ctx.user.id);

      const { data: candidates } = await ctx.supabase
        .from("candidates")
        .select("*, session:sessions(*)")
        .eq("interviewId", input.interviewId)
        .order("createdAt", { ascending: false });

      const linkedSessionIds = (candidates ?? [])
        .map((c: { sessionId: string | null }) => c.sessionId)
        .filter(Boolean);

      let walkInQuery = ctx.supabase
        .from("sessions")
        .select("*, messages(id)")
        .eq("interviewId", input.interviewId)
        .order("createdAt", { ascending: false });

      if (linkedSessionIds.length > 0) {
        walkInQuery = walkInQuery.not(
          "id",
          "in",
          `(${linkedSessionIds.join(",")})`,
        );
      }

      const { data: sessions } = await walkInQuery;
      const walkInSessions = (sessions ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => ({
          ...s,
          _count: { messages: s.messages?.length ?? 0 },
        }),
      );

      return { candidates: candidates ?? [], walkInSessions };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        gender: z.string().optional(),
        birthday: z.string().optional(),
        notes: z.string().optional(),
        education: z.string().optional(),
        school: z.string().optional(),
        major: z.string().optional(),
        graduationYear: z.number().int().optional(),
        workExperience: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;

      // Get candidate's interview to verify access
      const { data: candidate } = await ctx.supabase
        .from("candidates")
        .select("interviewId")
        .eq("id", id)
        .single();

      if (!candidate) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { role } = await verifyInterviewAccess(
        ctx.supabase,
        candidate.interviewId,
        ctx.user.id,
      );
      assertMinRole(role, "MEMBER");

      const { data: updated, error } = await ctx.supabase
        .from("candidates")
        .update({ ...fields, updatedAt: new Date().toISOString() })
        .eq("id", id)
        .select("*, session:sessions(*)")
        .single();

      if (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
      }

      return updated;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: candidate } = await ctx.supabase
        .from("candidates")
        .select("interviewId")
        .eq("id", input.id)
        .single();

      if (!candidate) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { role } = await verifyInterviewAccess(
        ctx.supabase,
        candidate.interviewId,
        ctx.user.id,
      );
      assertMinRole(role, "MEMBER");

      // Deletion guard for MEMBER
      if (role === "MEMBER") {
        const { count } = await ctx.supabase
          .from("sessions")
          .select("*", { count: "exact", head: true })
          .eq("interviewId", candidate.interviewId)
          .in("status", ["IN_PROGRESS", "COMPLETED"]);

        if ((count ?? 0) > 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Cannot delete candidates from an interview with active or completed sessions. Contact an admin.",
          });
        }
      }

      await ctx.supabase.from("candidates").delete().eq("id", input.id);
      return { success: true };
    }),

  removeMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Verify all belong to same interview and user has access
      const { data: candidates } = await ctx.supabase
        .from("candidates")
        .select("interviewId")
        .in("id", input.ids);

      const interviewIds = Array.from(
        new Set((candidates ?? []).map((c) => c.interviewId)),
      );

      await Promise.all(
        interviewIds.map(async (iid) => {
          const { role } = await verifyInterviewAccess(
            ctx.supabase,
            iid,
            ctx.user.id,
          );
          assertMinRole(role, "MEMBER");

          if (role === "MEMBER") {
            const { count } = await ctx.supabase
              .from("sessions")
              .select("*", { count: "exact", head: true })
              .eq("interviewId", iid)
              .in("status", ["IN_PROGRESS", "COMPLETED"]);

            if ((count ?? 0) > 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message:
                  "Cannot delete candidates from an interview with active or completed sessions.",
              });
            }
          }
        })
      );

      await ctx.supabase.from("candidates").delete().in("id", input.ids);
      return { deleted: input.ids.length };
    }),

  listAll: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().optional(),
        projectId: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get org IDs for the user
      const { data: memberships } = await ctx.supabase
        .from("organization_members")
        .select("workspaceId")
        .eq("userId", ctx.user.id);

      let orgIds = (memberships ?? []).map(
        (m: { workspaceId: string }) => m.workspaceId,
      );

      if (input.organizationId) {
        if (!orgIds.includes(input.organizationId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
        }
        orgIds = [input.organizationId];
      }

      if (orgIds.length === 0)
        return { candidates: [], walkInSessions: [] };

      let projectIds: string[];
      if (input.projectId) {
        const projAccess = await hasProjectAccess(ctx.supabase, input.projectId, ctx.user.id);
        projectIds = projAccess ? [input.projectId] : [];
      } else {
        const { data: projects } = await ctx.supabase
          .from("projects")
          .select("id")
          .in("organizationId", orgIds);
        const allProjIds = (projects ?? []).map((p: { id: string }) => p.id);
        projectIds = await filterAccessibleProjectIds(ctx.supabase, allProjIds, ctx.user.id);
      }

      if (projectIds.length === 0)
        return { candidates: [], walkInSessions: [] };

      const { data: userInterviews } = await ctx.supabase
        .from("interviews")
        .select("id, title")
        .in("projectId", projectIds);

      const interviewIds = (userInterviews ?? []).map(
        (i: { id: string }) => i.id,
      );
      if (interviewIds.length === 0)
        return { candidates: [], walkInSessions: [] };

      const interviewMap = Object.fromEntries(
        (userInterviews ?? []).map((i) => [i.id, i.title]),
      );

      const { data: candidates } = await ctx.supabase
        .from("candidates")
        .select(
          "*, session:sessions(*), interview:interviews!inner(id, title)",
        )
        .in("interviewId", interviewIds)
        .order("createdAt", { ascending: false })
        .limit(input.limit);

      const linkedSessionIds = (candidates ?? [])
        .map((c: { sessionId: string | null }) => c.sessionId)
        .filter(Boolean);

      let walkInQuery = ctx.supabase
        .from("sessions")
        .select(
          "*, messages(id), interview:interviews!inner(id, title)",
        )
        .in("interviewId", interviewIds)
        .order("createdAt", { ascending: false })
        .limit(input.limit);

      if (linkedSessionIds.length > 0) {
        walkInQuery = walkInQuery.not(
          "id",
          "in",
          `(${linkedSessionIds.join(",")})`,
        );
      }

      const { data: sessions } = await walkInQuery;
      const walkInSessions = (sessions ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => ({
          ...s,
          _count: { messages: s.messages?.length ?? 0 },
        }),
      );

      return {
        candidates: candidates ?? [],
        walkInSessions,
        interviewMap,
      };
    }),

  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: candidate } = await ctx.supabase
        .from("candidates")
        .select(
          "*, session:sessions(*), interview:interviews(*, questions(*))",
        )
        .eq("inviteToken", input.token)
        .single();

      if (!candidate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invalid invite link",
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const interview = candidate.interview as any;
      if (!interview) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Interview is no longer available",
        });
      }

      return candidate;
    }),
});
