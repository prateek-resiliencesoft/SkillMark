/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useOrg } from "@/components/org-provider";
import { Button } from "@/components/ui/button";
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  ChevronDown,
  Code,
  Copy,
  ExternalLink,
  FlaskConical,
  Key,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

const SAMPLE: Omit<TemplateVars, "link"> = {
  name: "Priya Sharma",
  interviewTitle: "Senior React Developer",
  organization: "Acme Corp",
  duration: "20 minutes",
  batchName: "October hiring",
};

const SCENARIOS = {
  scheduled: {
    label: "Scheduled",
    scheduledAt: "2026-11-07T10:00:00.000Z",
    expiresAt: "2026-11-08T23:59:59.000Z",
    notice: "Scheduled for: Sat, Nov 7, 10:00 AM · Link active until: Sun, Nov 8, 11:59 PM",
  },
  whole_week: {
    label: "Whole week",
    scheduledAt: undefined,
    expiresAt: "2026-11-09T23:59:59.000Z",
    notice: "Link active until: Mon, Nov 9, 11:59 PM",
  },
  single_day: {
    label: "Single day",
    scheduledAt: undefined,
    expiresAt: "2026-11-03T10:00:00.000Z",
    notice: "Link active until: Tue, Nov 3, 10:00 AM",
  },
  on_demand: {
    label: "On-demand",
    scheduledAt: undefined,
    expiresAt: undefined,
    notice: "You may start at your convenience.",
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;
type SectionId = "email" | "whatsapp" | "webhook";
type EmailPane = "resend" | "brevo" | "template";
type WhatsappPane = "resilio";
type WebhookPane = "outbound" | "inbound";

const OUTBOUND_EVENT_OPTIONS = [
  { id: "candidate.invited", label: "candidate.invited", desc: "Invite sent by email or WhatsApp" },
  { id: "session.started", label: "session.started", desc: "Candidate opens the interview room" },
  { id: "session.completed", label: "session.completed", desc: "Interview finished and scores ready" },
];

function generateRandomSecret(prefix = "whsec_") {
  if (typeof window === "undefined") return `${prefix}secret`;
  const array = new Uint8Array(20);
  window.crypto.getRandomValues(array);
  const hex = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}${hex}`;
}

const spring = { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.85 };

function Slide({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="slide"
          initial={reduce ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduce ? { opacity: 0, height: 0 } : { opacity: 0, height: 0 }}
          transition={reduce ? { duration: 0.01 } : spring}
          className={cn("overflow-hidden", className)}
        >
          <motion.div
            initial={reduce ? false : { y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: -6, opacity: 0 }}
            transition={reduce ? { duration: 0.01 } : { ...spring, delay: 0.04 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : "bg-muted-foreground/30",
      )}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ResendLogo() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://cdn.resend.com/brand/resend-icon-black.svg" alt="" className="h-7 w-7 dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://cdn.resend.com/brand/resend-icon-white.svg" alt="" className="hidden h-7 w-7 dark:block" />
    </>
  );
}

function BrevoLogo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0B996E" />
      <path
        fill="#fff"
        d="M9.2 8.5h6.4c3.4 0 5.6 1.9 5.6 4.7 0 1.9-1 3.3-2.6 4l3.2 6.3h-3.5l-2.8-5.7h-2.8v5.7H9.2V8.5zm3.5 2.5v4.1h2.6c1.6 0 2.5-.8 2.5-2.1s-.9-2-2.5-2H12.7z"
      />
    </svg>
  );
}

function ResilioLogo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#25D366]">
      <MessageCircle className="h-4 w-4 text-white" strokeWidth={2.5} />
    </div>
  );
}

function WebhookLogo({ tone }: { tone: "out" | "in" }) {
  return (
    <div
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg",
        tone === "out" ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300" : "bg-teal-500/15 text-teal-700 dark:text-teal-300",
      )}
    >
      {tone === "out" ? <Send className="h-4 w-4" /> : <Code className="h-4 w-4" />}
    </div>
  );
}

function ProviderTile({
  selected,
  connected,
  isDefault,
  logo,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  connected: boolean;
  isDefault?: boolean;
  logo: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.06] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]"
          : "border-border/80 bg-card/60 hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-1 origin-top bg-primary transition-transform duration-300",
          selected ? "scale-y-100" : "scale-y-0",
        )}
      />
      <div className="relative shrink-0">{logo}</div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-[family-name:var(--font-heading)] text-sm font-semibold tracking-tight">{title}</span>
          {connected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <StatusDot ok /> Connected
            </span>
          )}
          {isDefault && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Default</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <motion.span animate={{ rotate: selected ? 180 : 0 }} transition={spring} className="relative text-muted-foreground">
        <ChevronDown className="h-4 w-4" />
      </motion.span>
    </button>
  );
}

function CategoryRail({
  id,
  open,
  onToggle,
  icon,
  title,
  hint,
  connectedCount,
  total,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
  connectedCount: number;
  total: number;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border bg-gradient-to-b from-card to-card/40 shadow-sm transition-[border-color,box-shadow]",
        open ? "border-primary/25 shadow-md shadow-primary/5" : "border-border/70",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left sm:px-6"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted/80 text-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-[family-name:var(--font-heading)] text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {connectedCount}/{total} ready
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{hint}</p>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="text-muted-foreground">
          <ChevronDown className="h-5 w-5" />
        </motion.span>
      </button>
      <Slide open={open}>
        <div id={panelId} className="space-y-4 border-t border-border/60 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          {children}
        </div>
      </Slide>
    </section>
  );
}

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const canEdit = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const utils = trpc.useUtils();
  const query = trpc.integration.get.useQuery({ organizationId: orgId }, { enabled: !!orgId });

  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    email: true,
    whatsapp: false,
    webhook: false,
  });
  const [emailPane, setEmailPane] = useState<EmailPane | null>("resend");
  const [whatsappPane, setWhatsappPane] = useState<WhatsappPane | null>("resilio");
  const [webhookPane, setWebhookPane] = useState<WebhookPane | null>("outbound");

  const [resendKey, setResendKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [resendReplyTo, setResendReplyTo] = useState("");
  const [brevoKey, setBrevoKey] = useState("");
  const [brevoFromEmail, setBrevoFromEmail] = useState("");
  const [brevoFromName, setBrevoFromName] = useState("");
  const [brevoReplyTo, setBrevoReplyTo] = useState("");
  const [defaultEmailProvider, setDefaultEmailProvider] = useState<"resend" | "brevo">("resend");
  const [resilioKey, setResilioKey] = useState("");
  const [resilioBaseUrl, setResilioBaseUrl] = useState("");
  const [resilioTemplate, setResilioTemplate] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappBody, setWhatsappBody] = useState("");
  const [outboundWebhookUrl, setOutboundWebhookUrl] = useState("");
  const [outboundWebhookSecret, setOutboundWebhookSecret] = useState("");
  const [outboundWebhookEvents, setOutboundWebhookEvents] = useState<string[]>([
    "candidate.invited",
    "session.started",
    "session.completed",
  ]);
  const [inboundWebhookSecret, setInboundWebhookSecret] = useState("");
  const [previewScenario, setPreviewScenario] = useState<ScenarioKey>("scheduled");
  const [testEmail, setTestEmail] = useState("");
  const [testEmailProvider, setTestEmailProvider] = useState<"resend" | "brevo">("resend");
  const [testPhone, setTestPhone] = useState("");
  const [testWebhookEvent, setTestWebhookEvent] = useState<"candidate.invited" | "session.started" | "session.completed">(
    "candidate.invited",
  );
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
      toast({ title: "Settings saved" });
    },
    onError: (e) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const test = trpc.integration.sendTest.useMutation({
    onSuccess: (res) => toast({ title: `Test sent via ${res.provider ?? "provider"}` }),
    onError: (e) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const testWebhook = trpc.integration.testOutboundWebhook.useMutation({
    onSuccess: (res) => toast({ title: `Webhook delivered${res.status ? ` (HTTP ${res.status})` : ""}` }),
    onError: (e) => toast({ title: "Webhook test failed", description: e.message, variant: "destructive" }),
  });

  if (!orgId || query.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
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
    toast({ title: "Template body copied" });
    setTimeout(() => setCopiedMeta(false), 2000);
  };

  const copyInboundUrl = async () => {
    await navigator.clipboard.writeText(d.inboundWebhook.endpointUrl);
    setCopiedInboundUrl(true);
    toast({ title: "Inbound URL copied" });
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
    toast({ title: "cURL copied" });
    setTimeout(() => setCopiedInboundCurl(false), 2000);
  };

  const toggleEvent = (eventId: string) => {
    setOutboundWebhookEvents((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId],
    );
  };

  const handleSetDefaultProvider = (provider: "resend" | "brevo") => {
    setDefaultEmailProvider(provider);
    save.mutate({ organizationId: orgId, defaultEmailProvider: provider });
  };

  const toggleSection = (id: SectionId) => setOpenSections((s) => ({ ...s, [id]: !s[id] }));
  const toggleEmailPane = (pane: EmailPane) => setEmailPane((p) => (p === pane ? null : pane));
  const toggleWhatsappPane = (pane: WhatsappPane) => setWhatsappPane((p) => (p === pane ? null : pane));
  const toggleWebhookPane = (pane: WebhookPane) => setWebhookPane((p) => (p === pane ? null : pane));

  const emailReady = Number(!!d.resend.apiKeyHint) + Number(!!d.brevo.apiKeyHint);
  const detailShell =
    "mt-2 space-y-4 rounded-2xl border border-dashed border-border/80 bg-muted/20 p-4 sm:p-5";

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <header className="relative overflow-hidden rounded-3xl border bg-[radial-gradient(1200px_400px_at_0%_-10%,hsl(var(--primary)/0.12),transparent_55%),linear-gradient(to_bottom,hsl(var(--card)),hsl(var(--background)))] px-6 py-7 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="relative space-y-3"
        >
          <p className="text-xs font-medium text-muted-foreground">Project delivery stack</p>
          <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold tracking-tight sm:text-4xl">
            Integrations
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Open a channel, pick a provider, connect credentials, then run a live test. Email invite copy lives under the
            email providers.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              { label: "Email", ok: emailReady > 0 },
              { label: "WhatsApp", ok: !!d.resilio.apiKeyHint },
              { label: "Webhook", ok: !!d.outboundWebhook.url },
            ].map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs backdrop-blur"
              >
                <StatusDot ok={chip.ok} />
                {chip.label}
              </span>
            ))}
          </div>
        </motion.div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/25 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Preview scenario for templates</span>
        <div className="flex flex-wrap gap-1 rounded-xl bg-background/80 p-1">
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
            const selected = previewScenario === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPreviewScenario(key)}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="ig-scenario"
                    className="absolute inset-0 rounded-lg bg-muted shadow-sm"
                    transition={spring}
                  />
                )}
                <span className="relative z-10">{SCENARIOS[key].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {/* EMAIL */}
        <CategoryRail
          id="email"
          open={openSections.email}
          onToggle={() => toggleSection("email")}
          icon={<Mail className="h-5 w-5" />}
          title="Email providers"
          hint="Resend or Brevo for invite delivery, plus the shared invite template"
          connectedCount={emailReady}
          total={2}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ProviderTile
              selected={emailPane === "resend"}
              connected={!!d.resend.apiKeyHint}
              isDefault={defaultEmailProvider === "resend"}
              logo={<ResendLogo />}
              title="Resend"
              subtitle="Developer email API"
              onClick={() => toggleEmailPane("resend")}
            />
            <ProviderTile
              selected={emailPane === "brevo"}
              connected={!!d.brevo.apiKeyHint}
              isDefault={defaultEmailProvider === "brevo"}
              logo={<BrevoLogo />}
              title="Brevo"
              subtitle="Transactional email (v3 API)"
              onClick={() => toggleEmailPane("brevo")}
            />
          </div>

          <Slide open={emailPane === "resend"}>
            <div className={detailShell}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Connect Resend</h3>
                  <p className="text-xs text-muted-foreground">Add domain + API key from resend.com</p>
                </div>
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
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
                <div className="flex flex-wrap gap-2 pt-1">
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
                    Save Resend
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
            </div>
          </Slide>

          <Slide open={emailPane === "brevo"}>
            <div className={detailShell}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Connect Brevo</h3>
                  <p className="text-xs text-muted-foreground">API v3 key from Brevo → SMTP & API</p>
                </div>
                <a
                  href="https://app.brevo.com/settings/keys/api"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
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
                <div className="flex flex-wrap gap-2 pt-1">
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
                    Save Brevo
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
            </div>
          </Slide>

          {/* Email invite template — under email only */}
          <ProviderTile
            selected={emailPane === "template"}
            connected={!!emailSubject && !!emailBody}
            logo={
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Mail className="h-4 w-4" />
              </div>
            }
            title="Email invite template"
            subtitle={`Placeholders: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}`}
            onClick={() => toggleEmailPane("template")}
          />
          <Slide open={emailPane === "template"}>
            <div className={detailShell}>
              <div className="grid gap-6 lg:grid-cols-2">
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={save.isLoading}
                        onClick={() =>
                          save.mutate({
                            organizationId: orgId,
                            templates: { emailSubject, emailBody, whatsappBody },
                          })
                        }
                      >
                        Save template
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEmailSubject(d.defaults.emailSubject);
                          setEmailBody(d.defaults.emailBody);
                          setWhatsappBody(d.defaults.whatsappBody);
                        }}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Reset
                      </Button>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Live preview · {activeScenario.label}</Label>
                  <div className="mt-2 rounded-2xl border bg-background p-5 text-sm shadow-sm">
                    <div className="mb-3 border-b pb-3">
                      <p className="text-[11px] text-muted-foreground">Subject</p>
                      <p className="font-semibold">{renderTemplate(emailSubject, sample)}</p>
                    </div>
                    <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {renderTemplate(emailBody, sample)}
                    </div>
                    <div className="mt-4 border-t pt-3 text-center">
                      <span className="inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
                        Start interview
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Slide>
        </CategoryRail>

        {/* WHATSAPP */}
        <CategoryRail
          id="whatsapp"
          open={openSections.whatsapp}
          onToggle={() => toggleSection("whatsapp")}
          icon={<MessageCircle className="h-5 w-5 text-emerald-600" />}
          title="WhatsApp providers"
          hint="ResilioHub template messages for interview invites"
          connectedCount={d.resilio.apiKeyHint ? 1 : 0}
          total={1}
        >
          <ProviderTile
            selected={whatsappPane === "resilio"}
            connected={!!d.resilio.apiKeyHint}
            logo={<ResilioLogo />}
            title="ResilioHub"
            subtitle="WhatsApp Business via External API"
            onClick={() => toggleWhatsappPane("resilio")}
          />
          <Slide open={whatsappPane === "resilio"}>
            <div className={detailShell}>
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
                  <Input value={resilioBaseUrl} onChange={(e) => setResilioBaseUrl(e.target.value)} disabled={!canEdit} />
                </Field>
              </div>

              <div className="space-y-4 rounded-2xl border bg-background/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Template body</p>
                    <p className="text-xs text-muted-foreground">
                      UTILITY · en · <code>{resilioTemplate || WHATSAPP_META_TEMPLATE.name}</code>
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyMetaTemplate} className="h-8">
                    {copiedMeta ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                    {copiedMeta ? "Copied" : "Copy for ResilioHub"}
                  </Button>
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Editable Meta body</Label>
                    <Textarea
                      rows={8}
                      value={whatsappBody}
                      onChange={(e) => setWhatsappBody(e.target.value)}
                      disabled={!canEdit}
                      className="font-mono text-xs leading-relaxed"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Bubble preview · {activeScenario.label}</Label>
                    <div className="mt-2 max-w-md rounded-2xl bg-[#EFEAE2] p-4 shadow-inner dark:bg-stone-900">
                      <div className="relative rounded-2xl rounded-tl-none bg-[#DCF8C6] p-3 text-xs leading-relaxed text-black shadow-sm dark:bg-emerald-950/80 dark:text-emerald-100">
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
                    size="sm"
                    disabled={save.isLoading}
                    onClick={() =>
                      save.mutate({
                        organizationId: orgId,
                        resilioApiKey: resilioKey || undefined,
                        resilioBaseUrl,
                        resilioTemplateName: resilioTemplate,
                        templates: { emailSubject, emailBody, whatsappBody },
                      })
                    }
                  >
                    Save WhatsApp
                  </Button>
                  {d.resilio.apiKeyHint && (
                    <Button size="sm" variant="ghost" onClick={() => save.mutate({ organizationId: orgId, resilioApiKey: null })}>
                      Disconnect
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Slide>
        </CategoryRail>

        {/* WEBHOOKS */}
        <CategoryRail
          id="webhook"
          open={openSections.webhook}
          onToggle={() => toggleSection("webhook")}
          icon={<Webhook className="h-5 w-5 text-indigo-500" />}
          title="Webhooks"
          hint="Outbound event stream and inbound ATS triggers"
          connectedCount={Number(!!d.outboundWebhook.url) + Number(!!d.inboundWebhook.secret)}
          total={2}
        >
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> HMAC SHA-256 on outbound deliveries
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProviderTile
              selected={webhookPane === "outbound"}
              connected={!!d.outboundWebhook.url}
              logo={<WebhookLogo tone="out" />}
              title="Outbound webhook"
              subtitle="Push interview events to your URL"
              onClick={() => toggleWebhookPane("outbound")}
            />
            <ProviderTile
              selected={webhookPane === "inbound"}
              connected={!!d.inboundWebhook.secret}
              logo={<WebhookLogo tone="in" />}
              title="Inbound webhook"
              subtitle="Create candidates from ATS / Zapier"
              onClick={() => toggleWebhookPane("inbound")}
            />
          </div>

          <Slide open={webhookPane === "outbound"}>
            <div className={detailShell}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Destination URL">
                  <Input
                    placeholder="https://api.yourdomain.com/webhooks/skillmark"
                    value={outboundWebhookUrl}
                    onChange={(e) => setOutboundWebhookUrl(e.target.value)}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="HMAC signing secret">
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
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Subscribed events</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {OUTBOUND_EVENT_OPTIONS.map((ev) => {
                    const checked = outboundWebhookEvents.includes(ev.id);
                    return (
                      <label
                        key={ev.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors",
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
                          <p className="font-mono font-medium">{ev.label}</p>
                          <p className="text-[11px] leading-tight text-muted-foreground">{ev.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
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
                    Save outbound
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
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Slide>

          <Slide open={webhookPane === "inbound"}>
            <div className={detailShell}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Endpoint URL">
                  <div className="flex gap-2">
                    <Input value={d.inboundWebhook.endpointUrl} readOnly className="bg-muted/50 font-mono text-xs" />
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={copyInboundUrl}>
                      {copiedInboundUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </Field>
                <Field label="Secret token (X-Webhook-Secret)">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter or generate a secret"
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
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Key className="h-3.5 w-3.5" /> Example request
                  </Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={copyInboundCurl}>
                    {copiedInboundCurl ? <Check className="mr-1 h-3 w-3 text-emerald-600" /> : <Copy className="mr-1 h-3 w-3" />}
                    {copiedInboundCurl ? "Copied" : "Copy cURL"}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100 dark:bg-black">
                  {sampleCurl}
                </pre>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  disabled={save.isLoading}
                  onClick={() => save.mutate({ organizationId: orgId, inboundWebhookSecret })}
                >
                  Save inbound token
                </Button>
              )}
            </div>
          </Slide>
        </CategoryRail>
      </div>

      {/* TEST CONSOLE */}
      {canEdit && (
        <section className="overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <FlaskConical className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-heading)] text-base font-semibold tracking-tight">
                  Test connections
                </h2>
                <p className="text-xs text-muted-foreground">Fire a real email, WhatsApp, or outbound webhook ping</p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
            <div className="space-y-3 rounded-2xl border bg-background/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Email</p>
                <div className="inline-flex rounded-md border p-0.5 text-[10px]">
                  {(["resend", "brevo"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTestEmailProvider(p)}
                      className={cn(
                        "rounded px-2 py-0.5 capitalize",
                        testEmailProvider === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <Input type="email" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
              <Button
                className="w-full"
                variant="outline"
                size="sm"
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
                {test.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
                Send test email
              </Button>
            </div>

            <div className="space-y-3 rounded-2xl border bg-background/80 p-4">
              <p className="text-xs font-semibold">WhatsApp</p>
              <Input
                placeholder="+919876543210"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value.replace(/[^\d+]/g, ""))}
              />
              <Button
                className="w-full"
                variant="outline"
                size="sm"
                disabled={!testPhone || !d.resilio.apiKeyHint || test.isLoading}
                onClick={() => test.mutate({ organizationId: orgId, channel: "whatsapp", to: testPhone })}
              >
                {test.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="mr-1.5 h-3.5 w-3.5" />}
                Send WhatsApp
              </Button>
            </div>

            <div className="space-y-3 rounded-2xl border bg-background/80 p-4">
              <p className="text-xs font-semibold">Outbound webhook</p>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-xs"
                value={testWebhookEvent}
                onChange={(e) => setTestWebhookEvent(e.target.value as typeof testWebhookEvent)}
              >
                {OUTBOUND_EVENT_OPTIONS.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label}
                  </option>
                ))}
              </select>
              <Button
                className="w-full"
                variant="outline"
                size="sm"
                disabled={!d.outboundWebhook.url || testWebhook.isLoading}
                onClick={() => testWebhook.mutate({ organizationId: orgId, event: testWebhookEvent })}
              >
                {testWebhook.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Webhook className="mr-1.5 h-3.5 w-3.5" />}
                Ping webhook
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
