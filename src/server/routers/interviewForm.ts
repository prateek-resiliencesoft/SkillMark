/* eslint-disable @typescript-eslint/no-explicit-any */
import { nanoid } from "@/lib/id";
import {
  FIELD_TYPES,
  defaultFormFields,
  defaultInterviewConfig,
  deriveApplicationStatus,
  validateFieldDefinitions,
  type FormField,
  type InterviewConfig,
} from "@/lib/forms/schema";
import { appBaseUrl, loadApplicationContext, serializeApplication, type FormRow } from "@/server/integrations/applications";
import { syncFormInterview } from "@/server/integrations/form-interview";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertMinRole, getOrgMembership, protectedProcedure, router, type MemberRole } from "../trpc";

const fieldSchema = z.object({
  id: z.string().max(64),
  key: z.string().max(64),
  type: z.enum(FIELD_TYPES),
  label: z.string().max(300),
  description: z.string().max(1000).optional(),
  placeholder: z.string().max(300).optional(),
  required: z.boolean(),
  hidden: z.boolean().optional(),
  minLength: z.number().int().min(0).max(100000).optional(),
  maxLength: z.number().int().min(1).max(100000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(300).optional(),
  patternMessage: z.string().max(300).optional(),
  options: z.array(z.string().max(200)).max(200).optional(),
  defaultValue: z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(200))]).optional(),
  allowedFileTypes: z.array(z.string().max(10)).max(20).optional(),
  maxFileSizeMb: z.number().min(0.1).max(20).optional(),
  multiple: z.boolean().optional(),
});

const configSchema = z.object({
  title: z.string().max(300),
  description: z.string().max(5000).optional(),
  jobRole: z.string().max(300).optional(),
  jobDescription: z.string().max(20000).optional(),
  experienceLevel: z.enum(["intern", "junior", "mid", "senior", "lead"]).optional(),
  interviewType: z.enum(["technical", "behavioral", "mixed", "screening"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  numberOfQuestions: z.number().int().min(1).max(30).optional(),
  categories: z.array(z.string().max(60)).max(20).optional(),
  durationMinutes: z.number().int().min(5).max(180).optional(),
  questionSource: z.enum(["ai", "predefined"]).optional(),
  predefinedQuestions: z.array(z.string().max(2000)).max(50).optional(),
  evaluationCriteria: z.array(z.object({ name: z.string().max(200), description: z.string().max(1000).optional(), weight: z.number().min(0).max(100).optional() })).max(20).optional(),
  instructions: z.string().max(5000).optional(),
  language: z.string().max(10).optional(),
  mode: z.enum(["voice", "chat"]).optional(),
  antiCheatingEnabled: z.boolean().optional(),
  headMovementDetectionEnabled: z.boolean().optional(),
});

const settingsSchema = z.object({
  successMessage: z.string().max(1000).optional(),
  redirectToInterview: z.boolean().optional(),
});

type Ctx = { supabase: any; user: { id: string } };

async function requireOrg(ctx: Ctx, organizationId: string, min: MemberRole = "VIEWER") {
  const m = await getOrgMembership(ctx.supabase, organizationId, ctx.user.id);
  if (!m) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  assertMinRole(m.role, min);
  return m;
}

async function loadForm(ctx: Ctx, id: string, min: MemberRole = "VIEWER"): Promise<FormRow> {
  const { data } = await ctx.supabase.from("interview_forms").select("*").eq("id", id).maybeSingle();
  if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
  await requireOrg(ctx, data.organizationId, min);
  return data as FormRow;
}

export const interviewFormRouter = router({
  list: protectedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await requireOrg(ctx, input.organizationId);
    const { data } = await ctx.supabase
      .from("interview_forms")
      .select("id, publicId, name, description, status, interviewId, fields, config, publishedAt, createdAt, updatedAt, applications(id)")
      .eq("organizationId", input.organizationId)
      .order("updatedAt", { ascending: false });
    return (data ?? []).map((f: any) => ({
      ...f,
      fieldCount: Array.isArray(f.fields) ? f.fields.length : 0,
      applicationCount: Array.isArray(f.applications) ? f.applications.length : 0,
      fields: undefined,
      applications: undefined,
      interviewTitle: f.config?.title ?? null,
    }));
  }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const form = await loadForm(ctx, input.id);
    return { ...form, baseUrl: appBaseUrl() };
  }),

  create: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid(), projectId: z.string().uuid().optional(), name: z.string().min(1).max(200), template: z.enum(["default", "blank"]).default("default") }))
    .mutation(async ({ ctx, input }) => {
      await requireOrg(ctx, input.organizationId, "MEMBER");
      let projectId = input.projectId ?? null;
      if (projectId) {
        const { data: p } = await ctx.supabase.from("projects").select("organizationId").eq("id", projectId).maybeSingle();
        if (!p || p.organizationId !== input.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "Project does not belong to this organization" });
      } else {
        const { data: p } = await ctx.supabase.from("projects").select("id").eq("organizationId", input.organizationId).order("createdAt", { ascending: true }).limit(1).maybeSingle();
        projectId = p?.id ?? null;
      }
      if (!projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Create a project first" });
      const config: InterviewConfig = { ...defaultInterviewConfig(), title: input.name };
      const { data, error } = await ctx.supabase
        .from("interview_forms")
        .insert({
          publicId: `frm_${nanoid(16)}`,
          organizationId: input.organizationId,
          projectId,
          userId: ctx.user.id,
          name: input.name,
          status: "draft",
          fields: input.template === "default" ? defaultFormFields() : [],
          config,
          settings: { redirectToInterview: true, successMessage: "Thanks for applying! You can start your interview now." },
        })
        .select("*")
        .single();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data as FormRow;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      fields: z.array(fieldSchema).max(60).optional(),
      config: configSchema.optional(),
      settings: settingsSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await loadForm(ctx, input.id, "MEMBER");
      if (input.fields) {
        const errs = validateFieldDefinitions(input.fields as FormField[]);
        if (errs.length) throw new TRPCError({ code: "BAD_REQUEST", message: errs.join("; ") });
      }
      const { id, ...rest } = input;
      const { data, error } = await ctx.supabase
        .from("interview_forms")
        .update({ ...rest, updatedAt: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data as FormRow;
    }),

  /** Create/update the linked interview from config (AI or predefined questions). */
  syncInterview: protectedProcedure
    .input(z.object({ id: z.string().uuid(), regenerate: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const form = await loadForm(ctx, input.id, "MEMBER");
      try {
        return await syncFormInterview({ form, config: form.config as unknown as InterviewConfig, regenerate: input.regenerate });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Failed to prepare interview" });
      }
    }),

  publish: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    let form = await loadForm(ctx, input.id, "MEMBER");
    const errs = validateFieldDefinitions(form.fields);
    if (errs.length) throw new TRPCError({ code: "BAD_REQUEST", message: errs.join("; ") });
    if (!form.fields.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one field" });
    if (!form.interviewId) {
      try {
        await syncFormInterview({ form, config: form.config as unknown as InterviewConfig });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Interview not ready: ${err instanceof Error ? err.message : err}` });
      }
      form = await loadForm(ctx, input.id, "MEMBER");
    }
    const { data } = await ctx.supabase
      .from("interview_forms")
      .update({ status: "published", publishedAt: form.publishedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() })
      .eq("id", input.id)
      .select("*")
      .single();
    return data as FormRow;
  }),

  unpublish: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await loadForm(ctx, input.id, "MEMBER");
    const { data } = await ctx.supabase.from("interview_forms").update({ status: "unpublished", updatedAt: new Date().toISOString() }).eq("id", input.id).select("*").single();
    return data as FormRow;
  }),

  duplicate: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const form = await loadForm(ctx, input.id, "MEMBER");
    const { data, error } = await ctx.supabase
      .from("interview_forms")
      .insert({
        publicId: `frm_${nanoid(16)}`,
        organizationId: form.organizationId,
        projectId: form.projectId,
        userId: ctx.user.id,
        name: `${form.name} (copy)`,
        description: form.description,
        status: "draft",
        fields: form.fields,
        config: form.config,
        settings: form.settings,
      })
      .select("*")
      .single();
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data as FormRow;
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await loadForm(ctx, input.id, "ADMIN");
    await ctx.supabase.from("interview_forms").delete().eq("id", input.id);
    return { success: true };
  }),

  applications: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const form = await loadForm(ctx, input.id);
    const { data } = await ctx.supabase
      .from("applications")
      .select("id, publicId, candidateName, candidateEmail, candidatePhone, status, source, environment, createdAt, candidate:candidates(inviteToken, sessionId, session:sessions(id, status))")
      .eq("formId", form.id)
      .order("createdAt", { ascending: false })
      .limit(200);
    const base = appBaseUrl();
    return (data ?? []).map((a: any) => ({
      id: a.id,
      publicId: a.publicId,
      name: a.candidateName,
      email: a.candidateEmail,
      phone: a.candidatePhone,
      source: a.source,
      environment: a.environment,
      createdAt: a.createdAt,
      status: deriveApplicationStatus(a.status, a.candidate?.session),
      sessionId: a.candidate?.sessionId ?? null,
      interviewUrl: a.candidate?.inviteToken ? `${base}/i/invite/${a.candidate.inviteToken}` : null,
    }));
  }),

  application: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { data: app } = await ctx.supabase.from("applications").select("*").eq("id", input.id).maybeSingle();
    if (!app) throw new TRPCError({ code: "NOT_FOUND" });
    await requireOrg(ctx, app.organizationId);
    const { data: form } = await ctx.supabase.from("interview_forms").select("publicId, name").eq("id", app.formId).single();
    const { candidate, session } = await loadApplicationContext(app);
    return serializeApplication(app, form!, candidate, session, appBaseUrl(), true);
  }),

  usageLogs: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) })).query(async ({ ctx, input }) => {
    await requireOrg(ctx, input.organizationId);
    const { data } = await ctx.supabase
      .from("api_usage_logs")
      .select("id, method, endpoint, status, createdAt, apiKey:api_keys(name, keyPrefix, environment)")
      .eq("organizationId", input.organizationId)
      .order("createdAt", { ascending: false })
      .limit(input.limit);
    return data ?? [];
  }),
});
