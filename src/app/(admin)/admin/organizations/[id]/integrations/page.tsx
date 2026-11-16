"use client";

import {
  PageHeader,
  Panel,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import {
  Mail,
  MessageSquare,
  Save,
  Send,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function AdminOrgIntegrationsPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const org = trpc.platform.getOrganization.useQuery({ id });
  const integ = trpc.integration.get.useQuery({ organizationId: id });

  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [brevoApiKey, setBrevoApiKey] = useState("");
  const [brevoFromEmail, setBrevoFromEmail] = useState("");
  const [brevoFromName, setBrevoFromName] = useState("");
  const [resilioApiKey, setResilioApiKey] = useState("");
  const [resilioBaseUrl, setResilioBaseUrl] = useState("");
  const [defaultEmail, setDefaultEmail] = useState<"resend" | "brevo">("resend");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  useEffect(() => {
    if (!integ.data) return;
    setResendFrom(integ.data.resend.from);
    setBrevoFromEmail(integ.data.brevo.fromEmail);
    setBrevoFromName(integ.data.brevo.fromName);
    setResilioBaseUrl(integ.data.resilio.baseUrl);
    setDefaultEmail(integ.data.defaultEmailProvider);
    setWebhookUrl(integ.data.outboundWebhook.url);
    setEmailSubject(integ.data.templates.emailSubject);
    setEmailBody(integ.data.templates.emailBody);
  }, [integ.data]);

  const save = trpc.integration.save.useMutation({
    onSuccess: () => {
      toast({ title: "Integration settings saved successfully" });
      setResendApiKey("");
      setBrevoApiKey("");
      setResilioApiKey("");
      setWebhookSecret("");
      utils.integration.get.invalidate({ organizationId: id });
    },
    onError: (err) =>
      toast({
        title: "Could not save integrations",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (org.isLoading || integ.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "Organizations", href: "/admin/organizations" },
          { label: org.data?.name ?? "Organization", href: `/admin/organizations/${id}` },
          { label: "Integrations & Webhooks" },
        ]}
        title="Delivery Channels & Webhooks"
        description="Configure outbound email SMTP/API delivery, WhatsApp notification channels, and webhook event listeners for this organization."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Email - Resend Panel */}
        <Panel
          kicker="Email Service"
          title="Resend Integration"
          description={`Current Secret Hint: ${integ.data?.resend.apiKeyHint || "No key registered"}`}
        >
          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">API Key (Leave empty to keep current)</span>
              <Input
                type="password"
                placeholder="re_..."
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Sender From Address</span>
              <Input
                placeholder="interviews@yourcompany.com"
                value={resendFrom}
                onChange={(e) => setResendFrom(e.target.value)}
                className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
          </div>
        </Panel>

        {/* Email - Brevo Panel */}
        <Panel
          kicker="Email Service"
          title="Brevo (Sendinblue) Integration"
          description={`Current Secret Hint: ${integ.data?.brevo.apiKeyHint || "No key registered"}`}
        >
          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">API Key (Leave empty to keep current)</span>
              <Input
                type="password"
                placeholder="xkeysib-..."
                value={brevoApiKey}
                onChange={(e) => setBrevoApiKey(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Sender Email</span>
                <Input
                  placeholder="notifications@company.com"
                  value={brevoFromEmail}
                  onChange={(e) => setBrevoFromEmail(e.target.value)}
                  className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Sender Name</span>
                <Input
                  placeholder="Talent Acquisition"
                  value={brevoFromName}
                  onChange={(e) => setBrevoFromName(e.target.value)}
                  className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                />
              </label>
            </div>
          </div>
        </Panel>

        {/* WhatsApp - Resilio Panel */}
        <Panel
          kicker="Messaging Gateway"
          title="WhatsApp via Resilio"
          description={`Current Secret Hint: ${integ.data?.resilio.apiKeyHint || "No key registered"}`}
        >
          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Resilio API Key</span>
              <Input
                type="password"
                placeholder="Optional new key"
                value={resilioApiKey}
                onChange={(e) => setResilioApiKey(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Resilio Base URL</span>
              <Input
                placeholder="https://api.resilio.com"
                value={resilioBaseUrl}
                onChange={(e) => setResilioBaseUrl(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
          </div>
        </Panel>

        {/* Routing & Webhook Panel */}
        <Panel
          kicker="Event Pipeline"
          title="Default Routing & Outbound Webhooks"
          description="Outgoing event payload dispatch when interviews complete."
        >
          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Primary Email Gateway</span>
              <Select
                value={defaultEmail}
                onValueChange={(v) => setDefaultEmail(v as "resend" | "brevo")}
              >
                <SelectTrigger className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="resend">Resend API</SelectItem>
                  <SelectItem value="brevo">Brevo API</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Outbound Webhook URL</span>
              <Input
                placeholder="https://your-ats.com/api/webhooks/interview-completed"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">
                Signing Secret ({integ.data?.outboundWebhook.secretHint ? `Active hint: ${integ.data.outboundWebhook.secretHint}` : "None"})
              </span>
              <Input
                type="password"
                placeholder="whsec_..."
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              />
            </label>
          </div>
        </Panel>
      </div>

      {/* Invite Email Template */}
      <Panel
        kicker="Custom Communications"
        title="Candidate Invitation Email Template"
        description="Default copy dispatched when candidates are invited to an automated assessment."
      >
        <div className="space-y-3 max-w-3xl">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-foreground">Subject Line</span>
            <Input
              placeholder="Your Invitation to Interview at {{company}}"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-foreground">Email Body Template (Markdown / Plain Text)</span>
            <textarea
              className="min-h-32 w-full rounded-lg border border-border/70 bg-background p-3 text-xs font-mono leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-white/[0.08] dark:bg-zinc-900"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 pt-3 border-t border-border/50 dark:border-white/[0.06] flex justify-end">
          <TacticalButton
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                organizationId: id,
                resendApiKey: resendApiKey || undefined,
                resendFrom,
                brevoApiKey: brevoApiKey || undefined,
                brevoFromEmail,
                brevoFromName,
                resilioApiKey: resilioApiKey || undefined,
                resilioBaseUrl,
                defaultEmailProvider: defaultEmail,
                outboundWebhookUrl: webhookUrl,
                outboundWebhookSecret: webhookSecret || undefined,
                templates: {
                  emailSubject,
                  emailBody,
                },
              })
            }
            className="gap-1.5 text-xs h-9"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save All Integration Configurations</span>
          </TacticalButton>
        </div>
      </Panel>
    </div>
  );
}
