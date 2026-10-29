import { encryptSecret, maskSecret } from "@/lib/messaging/secrets";
import { RESILIO_DEFAULT_BASE_URL } from "@/lib/messaging/providers";
import { DEFAULT_TEMPLATES, mergeTemplates, type TemplateVars } from "@/lib/messaging/templates";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { appBaseUrl } from "../batch-access";
import { deliverEmail, deliverWhatsapp, loadDeliveryConfig } from "../invite-delivery";
import { assertMinRole, getOrgMembership, protectedProcedure, router } from "../trpc";

async function requireOrgRole(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
  userId: string,
  min: "VIEWER" | "ADMIN",
) {
  const membership = await getOrgMembership(supabase, organizationId, userId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  assertMinRole(membership.role, min);
}

/** undefined = keep current, "" or null = clear, string = replace. */
const secretInput = z.string().max(500).nullable().optional();

export const integrationRouter = router({
  get: protectedProcedure.input(z.object({ organizationId: z.string() })).query(async ({ ctx, input }) => {
    await requireOrgRole(ctx.supabase, input.organizationId, ctx.user.id, "VIEWER");
    const { data: row } = await ctx.supabase
      .from("org_integrations")
      .select("*")
      .eq("organizationId", input.organizationId)
      .maybeSingle();

    return {
      resend: {
        apiKeyHint: maskSecret(row?.resendApiKey),
        from: (row?.resendFrom as string | null) ?? "",
        replyTo: (row?.resendReplyTo as string | null) ?? "",
      },
      brevo: {
        apiKeyHint: maskSecret(row?.brevoApiKey),
        fromEmail: (row?.brevoFromEmail as string | null) ?? "",
        fromName: (row?.brevoFromName as string | null) ?? "",
        replyTo: (row?.brevoReplyTo as string | null) ?? "",
      },
      resilio: {
        apiKeyHint: maskSecret(row?.resilioApiKey),
        baseUrl: (row?.resilioBaseUrl as string | null) ?? RESILIO_DEFAULT_BASE_URL,
        templateName: (row?.resilioTemplateName as string | null) ?? "",
        templateLanguage: (row?.resilioTemplateLanguage as string | null) ?? "en",
      },
      defaultEmailProvider: ((row?.defaultEmailProvider as string | null) ?? "resend") as "resend" | "brevo",
      defaultWhatsappProvider: ((row?.defaultWhatsappProvider as string | null) ?? "resilio") as "resilio",
      outboundWebhook: {
        url: (row?.outboundWebhookUrl as string | null) ?? "",
        secretHint: maskSecret(row?.outboundWebhookSecret),
        events: (row?.outboundWebhookEvents as string[]) ?? ["candidate.invited", "session.started", "session.completed"],
      },
      inboundWebhook: {
        secret: (row?.inboundWebhookSecret as string | null) ?? "",
        endpointUrl: `${appBaseUrl()}/api/webhooks/candidates`,
      },
      templates: mergeTemplates(row?.messageTemplates),
      defaults: DEFAULT_TEMPLATES,
      appUrl: appBaseUrl(),
    };
  }),

  save: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        resendApiKey: secretInput,
        resendFrom: z.string().max(200).optional(),
        resendReplyTo: z.string().max(200).optional(),
        brevoApiKey: secretInput,
        brevoFromEmail: z.string().max(200).optional().or(z.literal("")),
        brevoFromName: z.string().max(100).optional().or(z.literal("")),
        brevoReplyTo: z.string().max(200).optional().or(z.literal("")),
        resilioApiKey: secretInput,
        resilioBaseUrl: z.string().url().max(200).optional().or(z.literal("")),
        resilioTemplateName: z.string().max(200).optional(),
        resilioTemplateLanguage: z.string().max(10).optional(),
        defaultEmailProvider: z.enum(["resend", "brevo"]).optional(),
        defaultWhatsappProvider: z.enum(["resilio"]).optional(),
        outboundWebhookUrl: z.string().url().max(500).optional().or(z.literal("")),
        outboundWebhookSecret: secretInput,
        outboundWebhookEvents: z.array(z.string()).optional(),
        inboundWebhookSecret: z.string().max(200).optional().or(z.literal("")),
        templates: z
          .object({
            emailSubject: z.string().max(300),
            emailBody: z.string().max(10_000),
            whatsappBody: z.string().max(10_000).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.supabase, input.organizationId, ctx.user.id, "ADMIN");

      const patch: Record<string, unknown> = { organizationId: input.organizationId };
      const secret = (v: string | null | undefined) => (v === undefined ? undefined : v ? encryptSecret(v.trim()) : null);

      const resendKey = secret(input.resendApiKey);
      const brevoKey = secret(input.brevoApiKey);
      const resilioKey = secret(input.resilioApiKey);
      const webhookSecret = secret(input.outboundWebhookSecret);

      if (resendKey !== undefined) patch.resendApiKey = resendKey;
      if (brevoKey !== undefined) patch.brevoApiKey = brevoKey;
      if (resilioKey !== undefined) patch.resilioApiKey = resilioKey;
      if (webhookSecret !== undefined) patch.outboundWebhookSecret = webhookSecret;

      if (input.resendFrom !== undefined) patch.resendFrom = input.resendFrom.trim() || null;
      if (input.resendReplyTo !== undefined) patch.resendReplyTo = input.resendReplyTo.trim() || null;

      if (input.brevoFromEmail !== undefined) patch.brevoFromEmail = input.brevoFromEmail.trim() || null;
      if (input.brevoFromName !== undefined) patch.brevoFromName = input.brevoFromName.trim() || null;
      if (input.brevoReplyTo !== undefined) patch.brevoReplyTo = input.brevoReplyTo.trim() || null;

      if (input.resilioBaseUrl !== undefined) patch.resilioBaseUrl = input.resilioBaseUrl.trim() || null;
      if (input.resilioTemplateName !== undefined) patch.resilioTemplateName = input.resilioTemplateName.trim() || null;
      if (input.resilioTemplateLanguage !== undefined) patch.resilioTemplateLanguage = input.resilioTemplateLanguage.trim() || null;

      if (input.defaultEmailProvider !== undefined) patch.defaultEmailProvider = input.defaultEmailProvider;
      if (input.defaultWhatsappProvider !== undefined) patch.defaultWhatsappProvider = input.defaultWhatsappProvider;

      if (input.outboundWebhookUrl !== undefined) patch.outboundWebhookUrl = input.outboundWebhookUrl.trim() || null;
      if (input.outboundWebhookEvents !== undefined) patch.outboundWebhookEvents = input.outboundWebhookEvents;

      if (input.inboundWebhookSecret !== undefined) {
        patch.inboundWebhookSecret = input.inboundWebhookSecret.trim() || null;
      }

      if (input.templates) patch.messageTemplates = input.templates;

      const { error } = await ctx.supabase.from("org_integrations").upsert(patch, { onConflict: "organizationId" });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  sendTest: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        channel: z.enum(["email", "whatsapp"]),
        provider: z.enum(["resend", "brevo", "resilio"]).optional(),
        to: z.string().min(3).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.supabase, input.organizationId, ctx.user.id, "ADMIN");
      const cfg = await loadDeliveryConfig(ctx.supabase, input.organizationId);
      const vars: TemplateVars = {
        name: ctx.user.email?.split("@")[0] ?? "Test Candidate",
        interviewTitle: "Sample Interview",
        organization: cfg.organizationName,
        link: `${appBaseUrl()}/i/invite/test-link`,
        duration: "20 minutes",
        batchName: "Test batch",
        scheduleNotice: "You may start at your convenience.",
      };
      const r =
        input.channel === "email"
          ? await deliverEmail(cfg, input.to.trim(), vars, undefined, input.provider as "resend" | "brevo" | undefined)
          : await deliverWhatsapp(cfg, input.to.replace(/[^\d+]/g, ""), vars);
      if (r.status !== "sent") throw new TRPCError({ code: "BAD_REQUEST", message: r.error ?? "Send failed" });
      return { ok: true, provider: r.provider };
    }),
});
