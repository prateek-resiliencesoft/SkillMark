"use client";

import { Button } from "@/components/ui/button";
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
      toast({ title: "Integrations saved" });
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
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/admin/organizations/${id}`}>
            ← {org.data?.name ?? "Organization"}
          </Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Integrations
        </h1>
        <p className="text-sm text-muted-foreground">
          Messaging providers, webhooks, and invite templates — same surface as
          the user Integrations page. Leave secret fields blank to keep current
          values.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Email — Resend</h2>
        <p className="text-xs text-muted-foreground">
          Current hint: {integ.data?.resend.apiKeyHint || "none"}
        </p>
        <Input
          type="password"
          placeholder="New API key (optional)"
          value={resendApiKey}
          onChange={(e) => setResendApiKey(e.target.value)}
        />
        <Input
          placeholder="From address"
          value={resendFrom}
          onChange={(e) => setResendFrom(e.target.value)}
        />
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Email — Brevo</h2>
        <p className="text-xs text-muted-foreground">
          Current hint: {integ.data?.brevo.apiKeyHint || "none"}
        </p>
        <Input
          type="password"
          placeholder="New API key (optional)"
          value={brevoApiKey}
          onChange={(e) => setBrevoApiKey(e.target.value)}
        />
        <Input
          placeholder="From email"
          value={brevoFromEmail}
          onChange={(e) => setBrevoFromEmail(e.target.value)}
        />
        <Input
          placeholder="From name"
          value={brevoFromName}
          onChange={(e) => setBrevoFromName(e.target.value)}
        />
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">WhatsApp — Resilio</h2>
        <p className="text-xs text-muted-foreground">
          Current hint: {integ.data?.resilio.apiKeyHint || "none"}
        </p>
        <Input
          type="password"
          placeholder="New API key (optional)"
          value={resilioApiKey}
          onChange={(e) => setResilioApiKey(e.target.value)}
        />
        <Input
          placeholder="Base URL"
          value={resilioBaseUrl}
          onChange={(e) => setResilioBaseUrl(e.target.value)}
        />
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Defaults & webhooks</h2>
        <label className="block space-y-1.5 text-xs">
          <span className="text-muted-foreground">Default email provider</span>
          <Select
            value={defaultEmail}
            onValueChange={(v) => setDefaultEmail(v as "resend" | "brevo")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resend">Resend</SelectItem>
              <SelectItem value="brevo">Brevo</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Input
          placeholder="Outbound webhook URL"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
        <Input
          type="password"
          placeholder={`Webhook secret (${integ.data?.outboundWebhook.secretHint || "none"})`}
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
        />
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Invite email template</h2>
        <Input
          placeholder="Subject"
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
        />
        <textarea
          className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
        />
      </section>

      <Button
        disabled={save.isPending}
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
      >
        Save integrations
      </Button>
    </div>
  );
}
