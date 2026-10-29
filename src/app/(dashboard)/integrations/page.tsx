"use client";

import { useOrg } from "@/components/org-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  TEMPLATE_PLACEHOLDERS,
  WHATSAPP_META_TEMPLATE,
  renderTemplate,
  renderWhatsappPreview,
  type TemplateVars,
} from "@/lib/messaging/templates";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-react";
import { useEffect, useState } from "react";

const SAMPLE: Omit<TemplateVars, "link"> = {
  name: "Priya Sharma",
  interviewTitle: "Senior React Developer",
  organization: "Acme Corp",
  duration: "20 minutes",
  batchName: "October hiring",
};

const SCENARIOS = {
  scheduled: {
    label: "Scheduled (Sat 10:00 AM)",
    scheduledAt: "2026-11-07T10:00:00.000Z",
    expiresAt: "2026-11-08T23:59:59.000Z",
    notice: "Scheduled for: Sat, Nov 7, 10:00 AM · Link active until: Sun, Nov 8, 11:59 PM",
  },
  whole_week: {
    label: "Whole week (7 days)",
    scheduledAt: undefined,
    expiresAt: "2026-11-09T23:59:59.000Z",
    notice: "Link active until: Mon, Nov 9, 11:59 PM",
  },
  single_day: {
    label: "Single day (24 hours)",
    scheduledAt: undefined,
    expiresAt: "2026-11-03T10:00:00.000Z",
    notice: "Link active until: Tue, Nov 3, 10:00 AM",
  },
  on_demand: {
    label: "On-demand (No schedule)",
    scheduledAt: undefined,
    expiresAt: undefined,
    notice: "You may start at your convenience.",
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;

const OUTBOUND_EVENT_OPTIONS = [
  { id: "candidate.invited", label: "candidate.invited", desc: "Fired when an interview invite is sent via Email or WhatsApp" },
  { id: "session.started", label: "session.started", desc: "Fired when candidate accesses their interview room" },
  { id: "session.completed", label: "session.completed", desc: "Fired when candidate completes the interview and scores are ready" },
];

function generateRandomSecret(prefix = "whsec_") {
  if (typeof window === "undefined") return `${prefix}secret`;
  const array = new Uint8Array(20);
  window.crypto.getRandomValues(array);
  const hex = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}${hex}`;
}

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const canEdit = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const utils = trpc.useUtils();
  const query = trpc.integration.get.useQuery({ organizationId: orgId }, { enabled: !!orgId });

  // Resend state
  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [resendReplyTo, setResendReplyTo] = useState("");

  // Brevo state
  const [brevoKey, setBrevoKey] = useState("");
  const [brevoFromEmail, setBrevoFromEmail] = useState("");
  const [brevoFromName, setBrevoFromName] = useState("");
  const [brevoReplyTo, setBrevoReplyTo] = useState("");

  // Default provider state
  const [defaultEmailProvider, setDefaultEmailProvider] = useState<"resend" | "brevo">("resend");

  // WhatsApp state
  const [resilioKey, setResilioKey] = useState("");
  const [resilioBaseUrl, setResilioBaseUrl] = useState("");
  const [resilioTemplate, setResilioTemplate] = useState("");

  // Templates state
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappBody, setWhatsappBody] = useState("");

  // Webhook state
  const [outboundWebhookUrl, setOutboundWebhookUrl] = useState("");
  const [outboundWebhookSecret, setOutboundWebhookSecret] = useState("");
  const [outboundWebhookEvents, setOutboundWebhookEvents] = useState<string[]>([
    "candidate.invited",
    "session.started",
    "session.completed",
  ]);
  const [inboundWebhookSecret, setInboundWebhookSecret] = useState("");

  // Testing & Preview state
  const [previewScenario, setPreviewScenario] = useState<ScenarioKey>("scheduled");
  const [testEmail, setTestEmail] = useState("");
  const [testEmailProvider, setTestEmailProvider] = useState<"resend" | "brevo">("resend");
  const [testPhone, setTestPhone] = useState("");
  const [copiedMeta, setCopiedMeta] = useState(false);
  const [copiedInboundUrl, setCopiedInboundUrl] = useState(false);
  const [copiedInboundCurl, setCopiedInboundCurl] = useState(false);

  useEffect(() => {
    const d = query.data;
    if (!d) return;
    setResendFrom(d.resend.from);
    setResendReplyTo(d.resend.replyTo);

    setBrevoFromEmail(d.brevo.fromEmail);
    setBrevoFromName(d.brevo.fromName);
    setBrevoReplyTo(d.brevo.replyTo);

    setDefaultEmailProvider(d.defaultEmailProvider || "resend");
    setTestEmailProvider(d.defaultEmailProvider || "resend");

    setResilioBaseUrl(d.resilio.baseUrl);
    setResilioTemplate(d.resilio.templateName);

    setEmailSubject(d.templates.emailSubject);
    setEmailBody(d.templates.emailBody);
    setWhatsappBody(d.templates.whatsappBody || d.defaults.whatsappBody);

    setOutboundWebhookUrl(d.outboundWebhook.url);
    setOutboundWebhookEvents(d.outboundWebhook.events || ["candidate.invited", "session.started", "session.completed"]);
    setInboundWebhookSecret(d.inboundWebhook.secret);
  }, [query.data]);

  const save = trpc.integration.save.useMutation({
    onSuccess: () => {
      setResendKey("");
      setBrevoKey("");
      setResilioKey("");
      setOutboundWebhookSecret("");
      void utils.integration.get.invalidate();
      toast({ title: "Settings saved successfully" });
    },
    onError: (e) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const test = trpc.integration.sendTest.useMutation({
    onSuccess: (res) => toast({ title: `Test email sent via ${res.provider ?? "configured provider"}` }),
    onError: (e) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  if (!orgId || query.isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  const d = query.data!;

  const activeScenario = SCENARIOS[previewScenario];
  const sample: TemplateVars = {
    ...SAMPLE,
    link: `${d.appUrl}/i/invite/abc123xyz789`,
    scheduledAt: activeScenario.scheduledAt,
    expiresAt: activeScenario.expiresAt,
    scheduleNotice: activeScenario.notice,
  };

  const copyMetaTemplate = async () => {
    await navigator.clipboard.writeText(whatsappBody || WHATSAPP_META_TEMPLATE.body);
    setCopiedMeta(true);
    toast({ title: "Copied template body to clipboard" });
    setTimeout(() => setCopiedMeta(false), 2000);
  };

  const copyInboundUrl = async () => {
    await navigator.clipboard.writeText(d.inboundWebhook.endpointUrl);
    setCopiedInboundUrl(true);
    toast({ title: "Inbound webhook URL copied" });
    setTimeout(() => setCopiedInboundUrl(false), 2000);
  };

  const sampleCurl = `curl -X POST "${d.inboundWebhook.endpointUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: ${inboundWebhookSecret || "YOUR_SECRET_TOKEN"}" \\
  -d '{
    "organizationId": "${orgId}",
    "batchId": "YOUR_BATCH_ID",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "sendInviteImmediately": true,
    "emailProvider": "${defaultEmailProvider}"
  }'`;

  const copyInboundCurl = async () => {
    await navigator.clipboard.writeText(sampleCurl);
    setCopiedInboundCurl(true);
    toast({ title: "cURL example copied to clipboard" });
    setTimeout(() => setCopiedInboundCurl(false), 2000);
  };

  const toggleEvent = (eventId: string) => {
    setOutboundWebhookEvents((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  };

  const handleSetDefaultProvider = (provider: "resend" | "brevo") => {
    setDefaultEmailProvider(provider);
    save.mutate({
      organizationId: orgId,
      defaultEmailProvider: provider,
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Integrations & Messaging</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Deliver synchronized interview links by Email (Resend or Brevo) and WhatsApp (ResilioHub), or automate candidates and events via Webhooks.
        </p>
      </div>

      {/* Scenario switcher toolbar for previews */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Interactive Preview Scenario:</span>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1">
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
            const isSelected = previewScenario === key;
            return (
              <button
                key={key}
                type="button"
                className={cn(
                  "relative rounded-md px-3 py-1 text-xs font-medium transition-colors outline-none",
                  isSelected
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setPreviewScenario(key)}
              >
                {isSelected && (
                  <motion.div
                    layoutId="integration-scenario-pill"
                    className="pointer-events-none absolute inset-0 rounded-md bg-background shadow-xs dark:bg-card"
                    transition={{ type: "spring", stiffness: 450, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{SCENARIOS[key].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* EMAIL PROVIDERS: RESEND & BREVO */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> Email Delivery Providers
            </h3>
            <p className="text-xs text-muted-foreground">
              Connect one or both providers. Choose your default sender below; you can also switch providers per batch send.
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-medium">Default Sender:</span>
              <div className="inline-flex rounded-lg border bg-muted/40 p-1">
                <button
                  type="button"
                  onClick={() => handleSetDefaultProvider("resend")}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-colors",
                    defaultEmailProvider === "resend"
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDefaultProvider("brevo")}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-colors",
                    defaultEmailProvider === "brevo"
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Brevo
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Resend Email Configuration */}
          <Card className="flex flex-col justify-between">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>Resend</span>
                  {d.resend.apiKeyHint && <Connected />}
                  {defaultEmailProvider === "resend" && <DefaultBadge />}
                </CardTitle>
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <CardDescription className="text-xs">
                Developer-first email delivery. Add your domain and API key from resend.com.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              <Field label="API key">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={d.resend.apiKeyHint ? `Saved (${d.resend.apiKeyHint}) — leave blank to keep` : "re_..."}
                  value={resendKey}
                  onChange={(e) => setResendKey(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="From address">
                <Input
                  placeholder="Hiring Team <hiring@yourdomain.com>"
                  value={resendFrom}
                  onChange={(e) => setResendFrom(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Reply-to (optional)">
                <Input
                  placeholder="recruiter@yourdomain.com"
                  value={resendReplyTo}
                  onChange={(e) => setResendReplyTo(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    disabled={save.isLoading}
                    onClick={() =>
                      save.mutate({
                        organizationId: orgId,
                        resendApiKey: resendKey || undefined,
                        resendFrom,
                        resendReplyTo,
                      })
                    }
                  >
                    Save Resend settings
                  </Button>
                  {d.resend.apiKeyHint && defaultEmailProvider !== "resend" && (
                    <Button size="sm" variant="outline" onClick={() => handleSetDefaultProvider("resend")}>
                      Set as default
                    </Button>
                  )}
                  {d.resend.apiKeyHint && (
                    <Button size="sm" variant="ghost" onClick={() => save.mutate({ organizationId: orgId, resendApiKey: null })}>
                      Disconnect
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Brevo Email Configuration */}
          <Card className="flex flex-col justify-between">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>Brevo (Sendinblue)</span>
                  {d.brevo.apiKeyHint && <Connected />}
                  {defaultEmailProvider === "brevo" && <DefaultBadge />}
                </CardTitle>
                <a
                  href="https://app.brevo.com/settings/keys/api"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                  Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <CardDescription className="text-xs">
                Global transactional email platform. Generate an API v3 key in Brevo → SMTP & API.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              <Field label="API v3 key">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={d.brevo.apiKeyHint ? `Saved (${d.brevo.apiKeyHint}) — leave blank to keep` : "xkeysib-..."}
                  value={brevoKey}
                  onChange={(e) => setBrevoKey(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From email">
                  <Input
                    placeholder="hiring@yourdomain.com"
                    value={brevoFromEmail}
                    onChange={(e) => setBrevoFromEmail(e.target.value)}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="From name">
                  <Input
                    placeholder="Acme Hiring Team"
                    value={brevoFromName}
                    onChange={(e) => setBrevoFromName(e.target.value)}
                    disabled={!canEdit}
                  />
                </Field>
              </div>
              <Field label="Reply-to (optional)">
                <Input
                  placeholder="recruiter@yourdomain.com"
                  value={brevoReplyTo}
                  onChange={(e) => setBrevoReplyTo(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    disabled={save.isLoading}
                    onClick={() =>
                      save.mutate({
                        organizationId: orgId,
                        brevoApiKey: brevoKey || undefined,
                        brevoFromEmail,
                        brevoFromName,
                        brevoReplyTo,
                      })
                    }
                  >
                    Save Brevo settings
                  </Button>
                  {d.brevo.apiKeyHint && defaultEmailProvider !== "brevo" && (
                    <Button size="sm" variant="outline" onClick={() => handleSetDefaultProvider("brevo")}>
                      Set as default
                    </Button>
                  )}
                  {d.brevo.apiKeyHint && (
                    <Button size="sm" variant="ghost" onClick={() => save.mutate({ organizationId: orgId, brevoApiKey: null })}>
                      Disconnect
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* WHATSAPP: RESILIOHUB */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-500" /> WhatsApp · ResilioHub
            {d.resilio.apiKeyHint && <Connected />}
          </CardTitle>
          <CardDescription>
            Uses ResilioHub&apos;s External API (<code>POST /api/v1/send_templet</code>) with your connected WhatsApp Business
            account. Generate the API key in ResilioHub → API keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="API key">
              <Input
                type="password"
                autoComplete="off"
                placeholder={d.resilio.apiKeyHint ? `Saved (${d.resilio.apiKeyHint}) — leave blank to keep` : "API key JWT"}
                value={resilioKey}
                onChange={(e) => setResilioKey(e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Approved template name">
              <Input
                placeholder={WHATSAPP_META_TEMPLATE.name}
                value={resilioTemplate}
                onChange={(e) => setResilioTemplate(e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="API base URL">
              <Input
                value={resilioBaseUrl}
                onChange={(e) => setResilioBaseUrl(e.target.value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {/* Editable WhatsApp Template & Realtime Preview */}
          <div className="rounded-xl border bg-muted/30 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">WhatsApp Template Body</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Category: <span className="font-medium text-foreground">UTILITY</span> · Language:{" "}
                  <span className="font-medium text-foreground">English (en)</span> · Template Name:{" "}
                  <code>{resilioTemplate || WHATSAPP_META_TEMPLATE.name}</code>
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={copyMetaTemplate} className="h-8">
                {copiedMeta ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copiedMeta ? "Copied!" : "Copy body for ResilioHub"}
              </Button>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Editable Meta Template (Numbered variables <code>{"{{1}}"}</code> through <code>{"{{5}}"}</code>):
                </Label>
                <Textarea
                  rows={8}
                  value={whatsappBody}
                  onChange={(e) => setWhatsappBody(e.target.value)}
                  disabled={!canEdit}
                  className="font-mono text-xs leading-relaxed"
                />
                <p className="text-[11px] text-muted-foreground">
                  <b>Variables:</b> {"{{1}}"} candidate name · {"{{2}}"} interview title · {"{{3}}"} organization ·{" "}
                  {"{{4}}"} schedule & validity notice · {"{{5}}"} interview link.
                </p>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Real-time WhatsApp Bubble Preview ({activeScenario.label}):
                </Label>
                <div className="mt-2 rounded-2xl bg-[#EFEAE2] dark:bg-stone-900 p-4 shadow-inner max-w-md">
                  <div className="relative rounded-2xl rounded-tl-none bg-[#DCF8C6] dark:bg-emerald-950/80 p-3 text-xs leading-relaxed text-black dark:text-emerald-100 shadow-sm">
                    <div className="whitespace-pre-wrap">{renderWhatsappPreview(sample, whatsappBody)}</div>
                    <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-emerald-800 dark:text-emerald-300/70">
                      <span>10:00 AM</span>
                      <Check className="h-3 w-3 stroke-[3]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={save.isLoading}
                onClick={() =>
                  save.mutate({
                    organizationId: orgId,
                    resilioApiKey: resilioKey || undefined,
                    resilioBaseUrl,
                    resilioTemplateName: resilioTemplate,
                    templates: {
                      emailSubject,
                      emailBody,
                      whatsappBody,
                    },
                  })
                }
              >
                Save WhatsApp settings & template
              </Button>
              {d.resilio.apiKeyHint && (
                <Button variant="ghost" onClick={() => save.mutate({ organizationId: orgId, resilioApiKey: null })}>
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* UNIFIED EMAIL TEMPLATE */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Email Invite Template
          </CardTitle>
          <CardDescription>
            Uses the exact same clean layout and dynamic schedule notice as WhatsApp. Placeholders:{" "}
            {TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Subject">
              <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Body">
              <Textarea
                rows={12}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                disabled={!canEdit}
                className="font-mono text-xs leading-relaxed"
              />
            </Field>
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  disabled={save.isLoading}
                  onClick={() =>
                    save.mutate({
                      organizationId: orgId,
                      templates: { emailSubject, emailBody, whatsappBody },
                    })
                  }
                >
                  Save templates
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEmailSubject(d.defaults.emailSubject);
                    setEmailBody(d.defaults.emailBody);
                    setWhatsappBody(d.defaults.whatsappBody);
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to default
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Real-time Email Preview ({activeScenario.label}):</Label>
            <div className="mt-2 rounded-xl border bg-background p-5 shadow-sm text-sm">
              <div className="mb-3 border-b pb-3">
                <p className="text-xs text-muted-foreground">Subject:</p>
                <p className="font-semibold text-foreground">{renderTemplate(emailSubject, sample)}</p>
              </div>
              <div className="whitespace-pre-wrap text-muted-foreground leading-relaxed text-xs">
                {renderTemplate(emailBody, sample)}
              </div>
              <div className="mt-4 pt-3 border-t text-center">
                <div className="inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm">
                  Start interview
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* WEBHOOKS: OUTBOUND & INBOUND */}
      {/* ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-indigo-500" /> Webhooks & Automations
            </CardTitle>
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> HMAC SHA-256 Secured
            </span>
          </div>
          <CardDescription>
            Receive realtime candidate and interview event notifications (Outbound) or trigger automated candidate invites from ATS tools (Inbound).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Outbound Webhook Section */}
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-5">
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Send className="h-4 w-4 text-indigo-500" /> Outbound Webhook (Event Stream)
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                We will send an HTTP POST request with an <code>X-Skillmark-Signature</code> header whenever subscribed events occur.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Webhook destination URL">
                <Input
                  placeholder="https://api.yourdomain.com/webhooks/skillmark"
                  value={outboundWebhookUrl}
                  onChange={(e) => setOutboundWebhookUrl(e.target.value)}
                  disabled={!canEdit}
                />
              </Field>

              <Field label="HMAC Signing Secret">
                <div className="flex gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      d.outboundWebhook.secretHint
                        ? `Saved (${d.outboundWebhook.secretHint}) — leave blank to keep`
                        : "whsec_..."
                    }
                    value={outboundWebhookSecret}
                    onChange={(e) => setOutboundWebhookSecret(e.target.value)}
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setOutboundWebhookSecret(generateRandomSecret("whsec_"))}
                      title="Generate new secret"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Field>
            </div>

            <div className="space-y-2 pt-1">
              <Label className="text-xs text-muted-foreground">Subscribed Events:</Label>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {OUTBOUND_EVENT_OPTIONS.map((ev) => {
                  const checked = outboundWebhookEvents.includes(ev.id);
                  return (
                    <label
                      key={ev.id}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors",
                        checked ? "border-primary/40 bg-background" : "bg-muted/30 opacity-70",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!canEdit}
                        onCheckedChange={() => toggleEvent(ev.id)}
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5 text-xs">
                        <p className="font-mono font-medium text-foreground">{ev.label}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">{ev.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  disabled={save.isLoading}
                  onClick={() =>
                    save.mutate({
                      organizationId: orgId,
                      outboundWebhookUrl,
                      outboundWebhookSecret: outboundWebhookSecret || undefined,
                      outboundWebhookEvents,
                    })
                  }
                >
                  Save outbound webhook
                </Button>
                {d.outboundWebhook.url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      save.mutate({
                        organizationId: orgId,
                        outboundWebhookUrl: "",
                        outboundWebhookSecret: null,
                      })
                    }
                  >
                    Clear webhook
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Inbound Webhook Section */}
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-5">
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Code className="h-4 w-4 text-emerald-500" /> Inbound Webhook (Trigger Interviews)
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically create candidates and dispatch personalized interview invites from ATS tools, Zapier, Make, or custom forms.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Inbound endpoint URL">
                <div className="flex gap-2">
                  <Input value={d.inboundWebhook.endpointUrl} readOnly className="font-mono text-xs bg-muted/50" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={copyInboundUrl}
                    title="Copy URL"
                  >
                    {copiedInboundUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </Field>

              <Field label="Secret Token (Header: X-Webhook-Secret)">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter or generate a secret token"
                    value={inboundWebhookSecret}
                    onChange={(e) => setInboundWebhookSecret(e.target.value)}
                    disabled={!canEdit}
                    className="font-mono text-xs"
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setInboundWebhookSecret(generateRandomSecret("inbound_sec_"))}
                      title="Generate new token"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Field>
            </div>

            {/* Example curl request */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" /> Example Request:
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                  onClick={copyInboundCurl}
                >
                  {copiedInboundCurl ? <Check className="mr-1 h-3 w-3 text-emerald-600" /> : <Copy className="mr-1 h-3 w-3" />}
                  {copiedInboundCurl ? "Copied" : "Copy cURL"}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 dark:bg-black leading-relaxed">
                {sampleCurl}
              </pre>
            </div>

            {canEdit && (
              <div className="pt-2">
                <Button
                  size="sm"
                  disabled={save.isLoading}
                  onClick={() =>
                    save.mutate({
                      organizationId: orgId,
                      inboundWebhookSecret,
                    })
                  }
                >
                  Save inbound token
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* TEST MESSAGE SENDING */}
      {/* ──────────────────────────────────────────────────────────── */}
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Send a test</CardTitle>
            <CardDescription>
              Test sending an interview invitation via Resend, Brevo, or WhatsApp using sample details. Save settings first if you changed anything.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Test Email Invitation</Label>
                <div className="inline-flex rounded-md border bg-background p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setTestEmailProvider("resend")}
                    className={cn(
                      "rounded px-2 py-0.5 transition-colors",
                      testEmailProvider === "resend" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestEmailProvider("brevo")}
                    className={cn(
                      "rounded px-2 py-0.5 transition-colors",
                      testEmailProvider === "brevo" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    Brevo
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={
                    !testEmail ||
                    (testEmailProvider === "resend" && !d.resend.apiKeyHint) ||
                    (testEmailProvider === "brevo" && !d.brevo.apiKeyHint) ||
                    test.isLoading
                  }
                  onClick={() =>
                    test.mutate({
                      organizationId: orgId,
                      channel: "email",
                      provider: testEmailProvider,
                      to: testEmail,
                    })
                  }
                >
                  Send via {testEmailProvider === "resend" ? "Resend" : "Brevo"}
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <Label className="text-xs font-semibold">Test WhatsApp Message</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="+919876543210"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value.replace(/[^\d+]/g, ""))}
                />
                <Button
                  variant="outline"
                  disabled={!testPhone || !d.resilio.apiKeyHint || test.isLoading}
                  onClick={() => test.mutate({ organizationId: orgId, channel: "whatsapp", to: testPhone })}
                >
                  Send WhatsApp
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Connected() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      Connected
    </span>
  );
}

function DefaultBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      Default
    </span>
  );
}
