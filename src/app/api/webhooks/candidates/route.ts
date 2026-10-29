import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "@/lib/id";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appBaseUrl, inviteLink } from "@/server/batch-access";
import { deliverEmail, deliverWhatsapp, loadDeliveryConfig } from "@/server/invite-delivery";
import { formatScheduleNotice, type TemplateVars } from "@/lib/messaging/templates";
import { dispatchOutboundWebhook } from "@/lib/messaging/webhooks";

const inboundCandidateSchema = z.object({
  organizationId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  interviewId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(25).nullable().optional(),
  scheduledAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  school: z.string().max(200).nullable().optional(),
  major: z.string().max(200).nullable().optional(),
  graduationYear: z.number().int().nullable().optional(),
  workExperience: z.string().max(100).nullable().optional(),
  sendInviteImmediately: z.boolean().default(false),
  emailProvider: z.enum(["resend", "brevo"]).optional(),
  whatsappProvider: z.enum(["resilio"]).optional(),
});

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "Skillmark Inbound Candidate Webhook",
    documentation: "POST candidate JSON payload with X-Webhook-Secret header to ingest candidates.",
  });
}

export async function POST(req: NextRequest) {
  try {
    const rawSecret =
      req.headers.get("X-Webhook-Secret") ||
      req.headers.get("x-webhook-secret") ||
      req.nextUrl.searchParams.get("token") ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

    if (!rawSecret) {
      return NextResponse.json(
        { ok: false, error: "Missing webhook secret authentication" },
        { status: 401 },
      );
    }

    const bodyJson = await req.json().catch(() => null);
    if (!bodyJson || typeof bodyJson !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = inboundCandidateSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const supabase = supabaseAdmin;

    // Verify secret against org_integrations
    let orgQuery = supabase
      .from("org_integrations")
      .select("organizationId, inboundWebhookSecret, defaultEmailProvider, defaultWhatsappProvider, outboundWebhookUrl, outboundWebhookSecret, outboundWebhookEvents")
      .eq("inboundWebhookSecret", rawSecret.trim());

    if (data.organizationId) {
      orgQuery = orgQuery.eq("organizationId", data.organizationId);
    }

    const { data: orgIntegration, error: orgError } = await orgQuery.maybeSingle();

    if (orgError || !orgIntegration) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook secret or organization mismatch" },
        { status: 403 },
      );
    }

    const orgId = orgIntegration.organizationId;

    // Resolve interview ID
    let interviewId = data.interviewId;
    let batchId = data.batchId;

    if (!interviewId && batchId) {
      // Find interview in batch
      const { data: iv } = await supabase
        .from("interviews")
        .select("id")
        .eq("batchId", batchId)
        .limit(1)
        .maybeSingle();
      if (iv) interviewId = iv.id;
    }

    if (!interviewId) {
      // Fallback to most recent interview in organization
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("organizationId", orgId)
        .limit(1)
        .maybeSingle();

      if (project) {
        const { data: iv } = await supabase
          .from("interviews")
          .select("id, batchId")
          .eq("projectId", project.id)
          .order("createdAt", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (iv) {
          interviewId = iv.id;
          if (!batchId && iv.batchId) batchId = iv.batchId;
        }
      }
    }

    if (!interviewId) {
      return NextResponse.json(
        { ok: false, error: "No target interview found. Provide an explicit interviewId or batchId." },
        { status: 404 },
      );
    }

    // Insert candidate
    const token = nanoid(12);
    const { data: candidate, error: cError } = await supabase
      .from("candidates")
      .insert({
        interviewId,
        batchId: batchId || null,
        name: data.name,
        email: data.email?.toLowerCase() || null,
        phone: data.phone || null,
        scheduledAt: data.scheduledAt || null,
        expiresAt: data.expiresAt || null,
        notes: data.notes || null,
        school: data.school || null,
        major: data.major || null,
        graduationYear: data.graduationYear || null,
        workExperience: data.workExperience || null,
        inviteToken: token,
      })
      .select("*")
      .single();

    if (cError || !candidate) {
      return NextResponse.json(
        { ok: false, error: cError?.message || "Failed to create candidate" },
        { status: 500 },
      );
    }

    let emailStatus: string | null = null;
    let whatsappStatus: string | null = null;

    // Send immediately if requested
    if (data.sendInviteImmediately) {
      const deliveryCfg = await loadDeliveryConfig(supabase, orgId);
      const { data: ivData } = await supabase
        .from("interviews")
        .select("title")
        .eq("id", interviewId)
        .single();

      const chosenEmailProvider = data.emailProvider || deliveryCfg.defaultEmailProvider || "resend";
      const scheduleNotice = formatScheduleNotice(candidate.scheduledAt, candidate.expiresAt);

      const vars: TemplateVars = {
        name: candidate.name,
        interviewTitle: ivData?.title?.split(" · ")[0] ?? "Interview",
        organization: deliveryCfg.organizationName,
        link: inviteLink(candidate.inviteToken),
        duration: "20 minutes",
        batchName: "Inbound Webhook",
        scheduledAt: candidate.scheduledAt ?? undefined,
        expiresAt: candidate.expiresAt ?? undefined,
        scheduleNotice,
      };

      const candidateUpdates: Record<string, unknown> = {};

      if (candidate.email) {
        const emailRes = await deliverEmail(
          deliveryCfg,
          candidate.email,
          vars,
          undefined,
          chosenEmailProvider,
        );
        emailStatus = emailRes.status;
        candidateUpdates.emailStatus = emailRes.status;
        candidateUpdates.emailProvider = chosenEmailProvider;
        if (emailRes.status === "sent") candidateUpdates.emailSentAt = new Date().toISOString();
      }

      if (candidate.phone && candidate.phone.startsWith("+")) {
        const waRes = await deliverWhatsapp(deliveryCfg, candidate.phone, vars);
        whatsappStatus = waRes.status;
        candidateUpdates.whatsappStatus = waRes.status;
        candidateUpdates.whatsappProvider = "resilio";
        if (waRes.status === "sent") candidateUpdates.whatsappSentAt = new Date().toISOString();
      }

      if (Object.keys(candidateUpdates).length > 0) {
        await supabase.from("candidates").update(candidateUpdates).eq("id", candidate.id);
      }
    }

    // Dispatch outbound webhook if configured
    if (orgIntegration.outboundWebhookUrl) {
      void dispatchOutboundWebhook({
        url: orgIntegration.outboundWebhookUrl,
        secret: orgIntegration.outboundWebhookSecret,
        event: "candidate.invited",
        organizationId: orgId,
        subscribedEvents: orgIntegration.outboundWebhookEvents,
        data: {
          candidateId: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          inviteLink: `${appBaseUrl()}/i/invite/${candidate.inviteToken}`,
          scheduledAt: candidate.scheduledAt,
          expiresAt: candidate.expiresAt,
          sentImmediately: data.sendInviteImmediately,
          emailStatus,
          whatsappStatus,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      candidate: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        inviteToken: candidate.inviteToken,
        inviteLink: `${appBaseUrl()}/i/invite/${candidate.inviteToken}`,
        scheduledAt: candidate.scheduledAt,
        expiresAt: candidate.expiresAt,
      },
      delivery: {
        emailStatus,
        whatsappStatus,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error processing webhook" },
      { status: 500 },
    );
  }
}
