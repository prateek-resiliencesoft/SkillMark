import { extractJson } from "@/lib/ai/extract-json";
import { buildGeneratorPrompt } from "@/lib/ai/prompts/generator";
import { resolveTaskModels } from "@/lib/ai/registry";
import type { GeneratedInterview } from "@/lib/ai/types";
import { LANGUAGES } from "@/lib/constants";
import { experienceBucket, profileToResumeText, type CandidateProfile } from "@/lib/documents/cv-profile";
import { nanoid } from "@/lib/id";
import { createLogger } from "@/lib/logger";
import { formatScheduleNotice, type TemplateVars } from "@/lib/messaging/templates";
import { dispatchOutboundWebhook } from "@/lib/messaging/webhooks";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inviteLink,
  resolveDefaultProjectId,
  verifyBatchAccess,
  verifyProjectAccess,
} from "../batch-access";
import { deliverEmail, deliverWhatsapp, loadDeliveryConfig } from "../invite-delivery";
import { assertMinRole, protectedProcedure, router } from "../trpc";

const log = createLogger("routers/batch");

const QUESTION_TYPES = ["OPEN_ENDED", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "CODING", "WHITEBOARD", "RESEARCH"] as const;

const batchSettings = z.object({
  roleDescription: z.string().min(1).max(4000),
  jobDescription: z.string().max(20_000).optional(),
  durationMinutes: z.number().int().min(5).max(120).default(20),
  language: z.string().default("en"),
  chatEnabled: z.boolean().default(true),
  voiceEnabled: z.boolean().default(true),
  videoEnabled: z.boolean().default(true),
  aiTone: z.enum(["CASUAL", "PROFESSIONAL", "FORMAL", "FRIENDLY"]).default("FRIENDLY"),
  followUpDepth: z.enum(["LIGHT", "MODERATE", "DEEP"]).default("MODERATE"),
  antiCheatingEnabled: z.boolean().default(false),
  headMovementDetectionEnabled: z.boolean().default(false),
  defaultCountryCode: z.string().max(4).optional(),
  premadeQuestions: z
    .array(
      z.object({
        text: z.string(),
        type: z.string().optional(),
        sectionName: z.string().optional(),
        description: z.string().optional(),
        options: z.any().optional(),
        starterCode: z.any().optional(),
      }),
    )
    .max(50)
    .optional(),
});
export type BatchSettings = z.infer<typeof batchSettings>;

const profileSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  headline: z.string().nullable(),
  totalExperienceYears: z.number().nullable(),
  techStack: z.array(z.string()),
  experience: z.array(z.any()),
  projects: z.array(z.any()),
  education: z.array(z.any()),
  summary: z.string().nullable(),
});

const channelsSchema = z.object({ email: z.boolean(), whatsapp: z.boolean() });

type SessionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED" | "DISQUALIFIED";

function candidateStatus(c: { session?: { status?: string } | null }): SessionStatus {
  return (c.session?.status as SessionStatus | undefined) ?? "NOT_STARTED";
}

function summarize(candidates: { session?: { status?: string } | null }[]) {
  const counts = { total: candidates.length, completed: 0, inProgress: 0, notStarted: 0, abandoned: 0, disqualified: 0 };
  for (const c of candidates) {
    const s = candidateStatus(c);
    if (s === "COMPLETED") counts.completed++;
    else if (s === "IN_PROGRESS") counts.inProgress++;
    else if (s === "ABANDONED") counts.abandoned++;
    else if (s === "DISQUALIFIED") counts.disqualified++;
    else counts.notStarted++;
  }
  return counts;
}

export const batchRouter = router({
  create: protectedProcedure
    .input(z.object({ projectId: z.string().optional(), name: z.string().min(1).max(160), settings: batchSettings }))
    .mutation(async ({ ctx, input }) => {
      const projectId = input.projectId ?? (await resolveDefaultProjectId(ctx.supabase, ctx.user.id));
      const { role } = await verifyProjectAccess(ctx.supabase, projectId, ctx.user.id);
      assertMinRole(role, "MEMBER");

      const { data, error } = await ctx.supabase
        .from("interview_batches")
        .insert({ name: input.name, projectId, userId: ctx.user.id, settings: input.settings })
        .select("*")
        .single();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data as { id: string; name: string; createdAt: string };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const projectId = input.projectId ?? (await resolveDefaultProjectId(ctx.supabase, ctx.user.id));
      await verifyProjectAccess(ctx.supabase, projectId, ctx.user.id);

      const { data: batches, error } = await ctx.supabase
        .from("interview_batches")
        .select("id, name, createdAt, settings, candidates(id, emailStatus, whatsappStatus, session:sessions(status))")
        .eq("projectId", projectId)
        .order("createdAt", { ascending: false });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (batches ?? []).map((b: any) => ({
        id: b.id as string,
        name: b.name as string,
        createdAt: b.createdAt as string,
        roleDescription: (b.settings?.roleDescription as string | undefined) ?? "",
        counts: summarize(b.candidates ?? []),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invited: (b.candidates ?? []).filter((c: any) => c.emailStatus === "sent" || c.whatsappStatus === "sent").length,
      }));
    }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { batch, role } = await verifyBatchAccess(ctx.supabase, input.id, ctx.user.id);

    const { data: candidates, error } = await ctx.supabase
      .from("candidates")
      .select(
        "*, session:sessions(id, status, startedAt, completedAt, totalDurationSeconds, insights), interview:interviews(id, title, questions(id))",
      )
      .eq("batchId", input.id)
      .order("createdAt", { ascending: true });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (candidates ?? []).map((c: any) => ({
      id: c.id as string,
      name: c.name as string,
      email: (c.email as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      scheduledAt: (c.scheduledAt as string | null) ?? null,
      expiresAt: (c.expiresAt as string | null) ?? null,
      inviteToken: c.inviteToken as string,
      inviteLink: inviteLink(c.inviteToken),
      profile: (c.profile ?? null) as
        | (CandidateProfile & { reviewFlags?: { field: string; reason: string }[]; fileName?: string; extractionMethod?: string })
        | null,
      emailStatus: (c.emailStatus as string | null) ?? null,
      emailSentAt: (c.emailSentAt as string | null) ?? null,
      whatsappStatus: (c.whatsappStatus as string | null) ?? null,
      whatsappSentAt: (c.whatsappSentAt as string | null) ?? null,
      emailProvider: (c.emailProvider as string | null) ?? null,
      whatsappProvider: (c.whatsappProvider as string | null) ?? null,
      lastSendError: (c.lastSendError as string | null) ?? null,
      status: candidateStatus(c),
      sessionId: (c.session?.id as string | undefined) ?? null,
      startedAt: (c.session?.startedAt as string | undefined) ?? null,
      completedAt: (c.session?.completedAt as string | undefined) ?? null,
      durationSeconds: (c.session?.totalDurationSeconds as number | undefined) ?? null,
      interviewId: c.interview?.id as string,
      interviewTitle: (c.interview?.title as string | undefined) ?? "",
      questionCount: (c.interview?.questions?.length as number | undefined) ?? 0,
    }));

    return {
      id: batch.id as string,
      name: batch.name as string,
      createdAt: batch.createdAt as string,
      settings: batch.settings as BatchSettings,
      canEdit: role !== "VIEWER",
      counts: summarize(rows.map((r) => ({ session: { status: r.status === "NOT_STARTED" ? undefined : r.status } }))),
      candidates: rows,
    };
  }),

  /** Generates one CV-tailored interview + candidate invite inside a batch. */
  generateCandidate: protectedProcedure
    .input(
      z.object({
        batchId: z.string(),
        fileName: z.string().max(260),
        extractionMethod: z.string().max(30),
        resumeMarkdown: z.string().max(60_000),
        profile: profileSchema,
        reviewFlags: z.array(z.object({ field: z.string(), reason: z.string() })).max(40),
        contact: z.object({
          name: z.string().min(1).max(120),
          email: z.string().email().nullable(),
          phone: z.string().max(20).nullable(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { batch, role, organizationId } = await verifyBatchAccess(ctx.supabase, input.batchId, ctx.user.id);
      assertMinRole(role, "MEMBER");
      const settings = batch.settings as BatchSettings;
      const profile = { ...input.profile, name: input.contact.name, email: input.contact.email, phone: input.contact.phone } as CandidateProfile;

      // Structured profile first (cheap, dense), raw text after for details it missed.
      const resumeText = `${profileToResumeText(profile)}\n\n---\nOriginal CV text (excerpt):\n${input.resumeMarkdown.slice(0, 6000)}`;
      const messages = buildGeneratorPrompt(
        `${settings.roleDescription}\n\nThis interview is for one specific candidate (${input.contact.name}). Tailor questions to their tech stack, experience and projects listed in the resume, while still assessing the role requirements.`,
        settings.durationMinutes,
        LANGUAGES.find((l) => l.value === settings.language)?.label ?? settings.language,
        settings.jobDescription,
        resumeText,
        settings.premadeQuestions,
      );

      const { provider, generatorModel } = await resolveTaskModels(organizationId);
      let generated: GeneratedInterview | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !generated; attempt++) {
        try {
          const res = await provider.generateResponse({ messages, model: generatorModel, temperature: 0.6, maxTokens: 8192 });
          const parsed = extractJson<GeneratedInterview>(res.content.replace(/<think>[\s\S]*?<\/think>/g, ""));
          if (Array.isArray(parsed.questions) && parsed.questions.length > 0) generated = parsed;
          else lastError = new Error("AI returned no questions");
        } catch (err) {
          lastError = err;
          log.warn(`Batch generation attempt ${attempt + 1} failed`, err);
        }
      }
      if (!generated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not generate interview: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
        });
      }

      const { data: interview, error: ivError } = await ctx.supabase
        .from("interviews")
        .insert({
          title: `${generated.title} · ${input.contact.name}`.slice(0, 200),
          description: generated.description,
          objective: generated.objective,
          assessmentCriteria: generated.assessmentCriteria ?? null,
          chatEnabled: settings.chatEnabled,
          voiceEnabled: settings.voiceEnabled,
          videoEnabled: settings.voiceEnabled && settings.videoEnabled,
          aiName: generated.recommendedSettings?.aiName || "Skillmark",
          aiTone: settings.aiTone,
          followUpDepth: settings.followUpDepth,
          language: settings.language,
          timeLimitMinutes: settings.durationMinutes,
          antiCheatingEnabled: settings.antiCheatingEnabled,
          headMovementDetectionEnabled: settings.antiCheatingEnabled && !!settings.headMovementDetectionEnabled,
          projectId: batch.projectId,
          userId: ctx.user.id,
          requireInvite: true,
          batchId: batch.id,
        })
        .select("id, title")
        .single();
      if (ivError || !interview) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ivError?.message ?? "Failed to create interview" });
      }

      const questionRows = generated.questions.map((q, i) => ({
        interviewId: interview.id,
        order: i,
        text: q.text,
        type: (QUESTION_TYPES as readonly string[]).includes(q.type) ? q.type : "OPEN_ENDED",
        description: q.description ?? null,
        timeLimitSeconds: q.timeLimitSeconds ?? null,
        isRequired: q.isRequired ?? true,
        options: q.options ?? null,
        followUpPrompts: q.followUpPrompts ?? null,
        starterCode: q.type === "CODING" && q.starterCode ? q.starterCode : null,
      }));
      const { error: qError } = await ctx.supabase.from("questions").insert(questionRows);
      if (qError) {
        await ctx.supabase.from("interviews").delete().eq("id", interview.id);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: qError.message });
      }

      const edu = profile.education[0] as { institution?: string; field?: string; graduationYear?: number } | undefined;
      const { data: candidate, error: cError } = await ctx.supabase
        .from("candidates")
        .insert({
          interviewId: interview.id,
          batchId: batch.id,
          name: input.contact.name,
          email: input.contact.email?.toLowerCase() ?? null,
          phone: input.contact.phone,
          school: edu?.institution ?? null,
          major: edu?.field ?? null,
          graduationYear: edu?.graduationYear ?? null,
          workExperience: experienceBucket(profile.totalExperienceYears) ?? null,
          notes: profile.summary,
          profile: { ...profile, reviewFlags: input.reviewFlags, fileName: input.fileName, extractionMethod: input.extractionMethod },
          inviteToken: nanoid(12),
        })
        .select("id, inviteToken")
        .single();
      if (cError || !candidate) {
        await ctx.supabase.from("interviews").delete().eq("id", interview.id);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: cError?.message ?? "Failed to create candidate" });
      }

      return {
        candidateId: candidate.id as string,
        interviewId: interview.id as string,
        interviewTitle: interview.title as string,
        questionCount: questionRows.length,
        inviteLink: inviteLink(candidate.inviteToken),
      };
    }),

  updateContact: protectedProcedure
    .input(
      z.object({
        candidateId: z.string(),
        name: z.string().min(1).max(120),
        email: z.string().email().nullable(),
        phone: z.string().max(20).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: c } = await ctx.supabase.from("candidates").select("batchId").eq("id", input.candidateId).single();
      if (!c?.batchId) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
      const { role } = await verifyBatchAccess(ctx.supabase, c.batchId, ctx.user.id);
      assertMinRole(role, "MEMBER");
      const { error } = await ctx.supabase
        .from("candidates")
        .update({ name: input.name, email: input.email?.toLowerCase() ?? null, phone: input.phone, updatedAt: new Date().toISOString() })
        .eq("id", input.candidateId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  updateSchedule: protectedProcedure
    .input(
      z.object({
        candidateId: z.string(),
        scheduledAt: z.string().nullable().optional(),
        expiresAt: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: c } = await ctx.supabase.from("candidates").select("batchId").eq("id", input.candidateId).single();
      if (!c?.batchId) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
      const { role } = await verifyBatchAccess(ctx.supabase, c.batchId, ctx.user.id);
      assertMinRole(role, "MEMBER");
      const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt || null;
      if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt || null;
      const { error } = await ctx.supabase.from("candidates").update(patch).eq("id", input.candidateId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  /** Sends invite links. Omit candidateIds to send to the whole batch. */
  sendInvites: protectedProcedure
    .input(
      z.object({
        batchId: z.string(),
        candidateIds: z.array(z.string()).max(1000).optional(),
        channels: channelsSchema,
        emailProvider: z.enum(["resend", "brevo"]).optional(),
        whatsappProvider: z.enum(["resilio"]).optional(),
        onlyUnsent: z.boolean().default(false),
        defaultScheduledAt: z.string().nullable().optional(),
        defaultExpiresAt: z.string().nullable().optional(),
        candidateSchedules: z
          .array(
            z.object({
              candidateId: z.string(),
              scheduledAt: z.string().nullable().optional(),
              expiresAt: z.string().nullable().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { batch, role, organizationId } = await verifyBatchAccess(ctx.supabase, input.batchId, ctx.user.id);
      assertMinRole(role, "MEMBER");
      if (!input.channels.email && !input.channels.whatsapp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one channel" });
      }

      const cfg = await loadDeliveryConfig(ctx.supabase, organizationId);
      const hasEmail = !!cfg.resend || !!cfg.brevo;
      if (input.channels.email && !hasEmail) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No email provider (Resend or Brevo) is configured. Go to Settings → Integrations." });
      }
      if (input.channels.whatsapp && !cfg.resilio) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "WhatsApp (ResilioHub) is not configured. Go to Settings → Integrations." });
      }

      let query = ctx.supabase
        .from("candidates")
        .select("id, name, email, phone, inviteToken, emailStatus, whatsappStatus, scheduledAt, expiresAt, interview:interviews(title)")
        .eq("batchId", batch.id);
      if (input.candidateIds?.length) query = query.in("id", input.candidateIds);
      const { data: candidates, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const settings = batch.settings as BatchSettings;
      const results: { candidateId: string; email?: string; whatsapp?: string; error?: string }[] = [];

      // Small concurrency keeps provider rate limits happy (Resend: 2 req/s default).
      const queue = [...(candidates ?? [])];
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const override = input.candidateSchedules?.find((s) => s.candidateId === c.id);
          const scheduledAt = override?.scheduledAt !== undefined ? override.scheduledAt : input.defaultScheduledAt;
          const expiresAt = override?.expiresAt !== undefined ? override.expiresAt : input.defaultExpiresAt;

          const effectiveScheduledAt = scheduledAt !== undefined ? scheduledAt : (c.scheduledAt as string | null);
          const effectiveExpiresAt = expiresAt !== undefined ? expiresAt : (c.expiresAt as string | null);
          const scheduleNotice = formatScheduleNotice(effectiveScheduledAt, effectiveExpiresAt);

          const vars: TemplateVars = {
            name: c.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            interviewTitle: ((c.interview as any)?.title as string | undefined)?.split(" · ")[0] ?? batch.name,
            organization: cfg.organizationName,
            link: inviteLink(c.inviteToken),
            duration: `${settings.durationMinutes ?? 20} minutes`,
            batchName: batch.name,
            scheduledAt: effectiveScheduledAt ?? undefined,
            expiresAt: effectiveExpiresAt ?? undefined,
            scheduleNotice,
          };
          const update: Record<string, unknown> = {};
          if (scheduledAt !== undefined) update.scheduledAt = scheduledAt || null;
          if (expiresAt !== undefined) update.expiresAt = expiresAt || null;

          const errors: string[] = [];
          const row: (typeof results)[number] = { candidateId: c.id };

          if (input.channels.email && !(input.onlyUnsent && c.emailStatus === "sent")) {
            const r = await deliverEmail(cfg, c.email, vars, undefined, input.emailProvider);
            row.email = r.status;
            update.emailStatus = r.status;
            update.emailProvider = r.provider;
            if (r.status === "sent") update.emailSentAt = new Date().toISOString();
            if (r.error) errors.push(`Email (${r.provider}): ${r.error}`);
          }
          if (input.channels.whatsapp && !(input.onlyUnsent && c.whatsappStatus === "sent")) {
            const r = await deliverWhatsapp(cfg, c.phone, vars);
            row.whatsapp = r.status;
            update.whatsappStatus = r.status;
            update.whatsappProvider = r.provider;
            if (r.status === "sent") update.whatsappSentAt = new Date().toISOString();
            if (r.error) errors.push(`WhatsApp: ${r.error}`);
          }
          if (Object.keys(update).length) {
            update.lastSendError = errors.length ? errors.join(" · ").slice(0, 500) : null;
            await ctx.supabase.from("candidates").update(update).eq("id", c.id);
          }
          if (errors.length) row.error = errors.join(" · ");
          results.push(row);

          // Dispatch outbound webhook if configured
          if (cfg.outboundWebhook && (update.emailStatus === "sent" || update.whatsappStatus === "sent")) {
            void dispatchOutboundWebhook({
              url: cfg.outboundWebhook.url,
              secret: cfg.outboundWebhook.secret,
              event: "candidate.invited",
              organizationId,
              subscribedEvents: cfg.outboundWebhook.events,
              data: {
                candidateId: c.id,
                name: c.name,
                email: c.email,
                phone: c.phone,
                batchId: batch.id,
                batchName: batch.name,
                interviewTitle: vars.interviewTitle,
                inviteLink: vars.link,
                scheduledAt: vars.scheduledAt,
                expiresAt: vars.expiresAt,
                emailStatus: update.emailStatus,
                emailProvider: update.emailProvider,
                whatsappStatus: update.whatsappStatus,
                whatsappProvider: update.whatsappProvider,
              },
            });
          }

          await new Promise((r) => setTimeout(r, 300));
        }
      };
      await Promise.all([worker(), worker()]);

      return {
        results,
        emailSent: results.filter((r) => r.email === "sent").length,
        whatsappSent: results.filter((r) => r.whatsapp === "sent").length,
        failed: results.filter((r) => r.error).length,
      };
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { role } = await verifyBatchAccess(ctx.supabase, input.id, ctx.user.id);
    assertMinRole(role, "ADMIN");
    // Interviews cascade to their candidates, questions and sessions.
    await ctx.supabase.from("interviews").delete().eq("batchId", input.id);
    const { error } = await ctx.supabase.from("interview_batches").delete().eq("id", input.id);
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return { ok: true };
  }),
});
