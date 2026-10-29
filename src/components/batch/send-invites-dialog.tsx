"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatScheduleNotice } from "@/lib/messaging/templates";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type SendChannel = "email" | "whatsapp" | "both";

export interface Recipient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  scheduledAt?: string | null;
  expiresAt?: string | null;
}

const CHANNELS: { value: SendChannel; label: string; icon: React.ElementType }[] = [
  { value: "email", label: "Email", icon: Mail },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "both", label: "Both", icon: Send },
];

type ValidityPreset = "none" | "1_day" | "7_days" | "custom";

function toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function computeExpiresAt(
  scheduledDateStr: string | null | undefined,
  preset: ValidityPreset,
  customExpiryStr?: string | null,
): string | null {
  if (preset === "none") return null;
  if (preset === "custom") {
    if (!customExpiryStr) return null;
    const d = new Date(customExpiryStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const base = scheduledDateStr ? new Date(scheduledDateStr) : new Date();
  if (isNaN(base.getTime())) return null;
  const days = preset === "1_day" ? 1 : 7;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

interface CandidateScheduleState {
  isScheduled: boolean;
  scheduledDate: string;
  validityPreset: ValidityPreset;
  customExpiry: string;
}

export function SendInvitesDialog({
  open,
  onOpenChange,
  batchId,
  organizationId,
  recipients,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  organizationId: string | undefined;
  /** Candidates to send to. The whole list is sent in one go. */
  recipients: Recipient[];
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<SendChannel>("both");
  const [onlyUnsent, setOnlyUnsent] = useState(true);

  // Global schedule configuration
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [validityPreset, setValidityPreset] = useState<ValidityPreset>("7_days");
  const [customExpiry, setCustomExpiry] = useState("");

  // Per-candidate override configuration
  const [isPerCandidate, setIsPerCandidate] = useState(false);
  const [candidateOverrides, setCandidateOverrides] = useState<Record<string, CandidateScheduleState>>({});

  const integration = trpc.integration.get.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: open && !!organizationId },
  );
  const resendReady = !!integration.data?.resend.apiKeyHint && !!integration.data?.resend.from;
  const brevoReady = !!integration.data?.brevo.apiKeyHint && !!integration.data?.brevo.fromEmail;
  const emailReady = resendReady || brevoReady;
  const whatsappReady = !!integration.data?.resilio.apiKeyHint && !!integration.data?.resilio.templateName;

  const [selectedEmailProvider, setSelectedEmailProvider] = useState<"resend" | "brevo">("resend");

  useEffect(() => {
    if (!integration.data) return;
    const defaultProvider = integration.data.defaultEmailProvider || "resend";
    if (defaultProvider === "brevo" && brevoReady) {
      setSelectedEmailProvider("brevo");
    } else if (resendReady) {
      setSelectedEmailProvider("resend");
    } else if (brevoReady) {
      setSelectedEmailProvider("brevo");
    }
  }, [integration.data, resendReady, brevoReady]);

  useEffect(() => {
    if (!integration.data) return;
    if (emailReady && !whatsappReady) setChannel("email");
    else if (!emailReady && whatsappReady) setChannel("whatsapp");
  }, [integration.data, emailReady, whatsappReady]);

  // Set default scheduled date to upcoming Saturday or tomorrow 10:00 AM on initial open
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    // Default to upcoming Saturday 10:00 AM if weekdays, or next day 10:00 AM
    const target = new Date();
    const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
    target.setDate(now.getDate() + daysUntilSaturday);
    target.setHours(10, 0, 0, 0);
    setScheduledDate(toLocalDatetimeString(target));

    // Default custom expiry to 7 days from target
    const expiryTarget = new Date(target.getTime() + 7 * 24 * 60 * 60 * 1000);
    setCustomExpiry(toLocalDatetimeString(expiryTarget));

    // Prefill per-candidate state from existing records if any
    const initialOverrides: Record<string, CandidateScheduleState> = {};
    for (const r of recipients) {
      initialOverrides[r.id] = {
        isScheduled: !!r.scheduledAt,
        scheduledDate: r.scheduledAt ? toLocalDatetimeString(new Date(r.scheduledAt)) : toLocalDatetimeString(target),
        validityPreset: r.expiresAt ? "custom" : "7_days",
        customExpiry: r.expiresAt ? toLocalDatetimeString(new Date(r.expiresAt)) : toLocalDatetimeString(expiryTarget),
      };
    }
    setCandidateOverrides(initialOverrides);
  }, [open, recipients]);

  const send = trpc.batch.sendInvites.useMutation({
    onSuccess: (r) => {
      const parts = [
        r.emailSent ? `${r.emailSent} email${r.emailSent === 1 ? "" : "s"}` : null,
        r.whatsappSent ? `${r.whatsappSent} WhatsApp` : null,
      ].filter(Boolean);
      toast({
        title: parts.length ? `Sent ${parts.join(" and ")}` : "Nothing sent",
        description: r.failed ? `${r.failed} candidate(s) had problems — see the status column.` : undefined,
        variant: r.failed && !parts.length ? "destructive" : "default",
      });
      onSent?.();
      onOpenChange(false);
    },
    onError: (err) => toast({ title: "Could not send", description: err.message, variant: "destructive" }),
  });

  const wantsEmail = channel !== "whatsapp";
  const wantsWhatsapp = channel !== "email";
  const missingEmail = wantsEmail ? recipients.filter((r) => !r.email).length : 0;
  const missingPhone = wantsWhatsapp ? recipients.filter((r) => !r.phone?.startsWith("+")).length : 0;
  const blocked = (wantsEmail && !emailReady) || (wantsWhatsapp && !whatsappReady);

  // Calculate default preview notice
  const defaultScheduledIso = isScheduled && scheduledDate ? new Date(scheduledDate).toISOString() : null;
  const defaultExpiresIso = computeExpiresAt(isScheduled ? scheduledDate : null, validityPreset, customExpiry);
  const defaultNoticePreview = useMemo(
    () => formatScheduleNotice(defaultScheduledIso, defaultExpiresIso),
    [defaultScheduledIso, defaultExpiresIso],
  );

  const applyBatchScheduleToAll = () => {
    const updated: Record<string, CandidateScheduleState> = {};
    for (const r of recipients) {
      updated[r.id] = {
        isScheduled,
        scheduledDate,
        validityPreset,
        customExpiry,
      };
    }
    setCandidateOverrides(updated);
    toast({ title: "Schedule applied to all candidates" });
  };

  const updateCandidate = (id: string, patch: Partial<CandidateScheduleState>) => {
    setCandidateOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {
          isScheduled: false,
          scheduledDate,
          validityPreset: "7_days",
          customExpiry,
        }),
        ...patch,
      },
    }));
  };

  const handleSend = () => {
    let candidateSchedulesPayload: { candidateId: string; scheduledAt?: string | null; expiresAt?: string | null }[] | undefined;

    if (isPerCandidate) {
      candidateSchedulesPayload = recipients.map((r) => {
        const state = candidateOverrides[r.id];
        const sAt = state?.isScheduled && state.scheduledDate ? new Date(state.scheduledDate).toISOString() : null;
        const eAt = state ? computeExpiresAt(state.isScheduled ? state.scheduledDate : null, state.validityPreset, state.customExpiry) : null;
        return {
          candidateId: r.id,
          scheduledAt: sAt,
          expiresAt: eAt,
        };
      });
    }

    const effectiveEmailProvider =
      brevoReady && !resendReady ? "brevo" : resendReady && !brevoReady ? "resend" : selectedEmailProvider;

    send.mutate({
      batchId,
      candidateIds: recipients.map((r) => r.id),
      channels: { email: wantsEmail, whatsapp: wantsWhatsapp },
      emailProvider: wantsEmail ? effectiveEmailProvider : undefined,
      onlyUnsent: recipients.length > 1 && onlyUnsent,
      defaultScheduledAt: defaultScheduledIso,
      defaultExpiresAt: defaultExpiresIso,
      candidateSchedules: candidateSchedulesPayload,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Send interview invite{recipients.length === 1 ? ` to ${recipients[0].name}` : `s (${recipients.length} candidates)`}</span>
          </DialogTitle>
          <DialogDescription>
            Configure delivery channels, scheduled interview date/time, and invite link validity window.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5 py-2">
          {/* Channel selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivery Channel</Label>
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((c) => {
                const isSelected = channel === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setChannel(c.value)}
                    className={cn(
                      "group relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors outline-none",
                      isSelected
                        ? "border-primary/50 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="send-channel-active-indicator"
                        className="pointer-events-none absolute inset-0 rounded-lg border-2 border-primary bg-primary/5"
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                      />
                    )}
                    <c.icon className="relative z-10 h-4 w-4" />
                    <span className="relative z-10">{c.label}</span>
                  </button>
                );
              })}
            </div>

            {wantsEmail && emailReady && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-muted-foreground">Email Provider:</span>
                </div>
                {resendReady && brevoReady ? (
                  <div className="inline-flex rounded-md border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => setSelectedEmailProvider("resend")}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                        selectedEmailProvider === "resend"
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEmailProvider("brevo")}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                        selectedEmailProvider === "brevo"
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Brevo
                    </button>
                  </div>
                ) : (
                  <span className="font-medium text-foreground">
                    {resendReady ? "Resend" : "Brevo"}
                  </span>
                )}
              </div>
            )}
          </div>

          {integration.isLoading ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            blocked && (
              <div className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {wantsEmail && !emailReady && "Email (Resend/Brevo) is not set up. "}
                  {wantsWhatsapp && !whatsappReady && "WhatsApp (ResilioHub) is not set up. "}
                  <Link href="/integrations" className="font-medium underline">
                    Open Integrations
                  </Link>
                </p>
              </div>
            )
          )}

          {/* Schedule & Validity Card */}
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Interview Schedule & Link Validity</span>
              </div>
              {recipients.length > 1 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="per-candidate-toggle" className="text-xs text-muted-foreground cursor-pointer">
                    Customize per candidate
                  </Label>
                  <Switch
                    id="per-candidate-toggle"
                    checked={isPerCandidate}
                    onCheckedChange={setIsPerCandidate}
                  />
                </div>
              )}
            </div>

            {!isPerCandidate ? (
              <div className="space-y-4">
                {/* Specific schedule toggle */}
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Schedule for specific date & time</Label>
                    <p className="text-xs text-muted-foreground">
                      Interview date & time will be injected into email and WhatsApp templates
                    </p>
                  </div>
                  <Switch checked={isScheduled} onCheckedChange={setIsScheduled} />
                </div>

                {isScheduled && (
                  <div className="space-y-1.5 pl-1">
                    <Label className="text-xs font-medium">Scheduled Date & Time</Label>
                    <Input
                      type="datetime-local"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full sm:w-72 text-sm"
                    />
                  </div>
                )}

                {/* Validity window */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Link Validity Window</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { key: "7_days", label: "Whole week (7d)" },
                      { key: "1_day", label: "Single day (24h)" },
                      { key: "custom", label: "Custom date" },
                      { key: "none", label: "No expiration" },
                    ].map((preset) => {
                      const isSelected = validityPreset === preset.key;
                      return (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => setValidityPreset(preset.key as ValidityPreset)}
                          className={cn(
                            "relative rounded-lg border px-3 py-2 text-xs text-center transition-colors font-medium outline-none",
                            isSelected
                              ? "border-primary/50 text-primary font-semibold"
                              : "hover:bg-muted text-muted-foreground",
                          )}
                        >
                          {isSelected && (
                            <motion.div
                              layoutId="validity-preset-active-indicator"
                              className="pointer-events-none absolute inset-0 rounded-lg border-2 border-primary bg-primary/10"
                              transition={{ type: "spring", stiffness: 450, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {validityPreset === "custom" && (
                    <div className="mt-2 space-y-1.5">
                      <Label className="text-xs font-medium">Link Expires At</Label>
                      <Input
                        type="datetime-local"
                        value={customExpiry}
                        onChange={(e) => setCustomExpiry(e.target.value)}
                        className="w-full sm:w-72 text-sm"
                      />
                    </div>
                  )}
                </div>

                {/* Live notice preview */}
                <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    <span>Dynamic notice injected into message:</span>
                  </div>
                  <p className="text-muted-foreground italic pl-5">&ldquo;{defaultNoticePreview}&rdquo;</p>
                </div>
              </div>
            ) : (
              /* Per candidate customization */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <p className="text-xs text-muted-foreground">
                    Configure interview schedule and validity individually for each candidate.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={applyBatchScheduleToAll} className="h-7 text-xs">
                    <SlidersHorizontal className="mr-1.5 h-3 w-3" />
                    Apply batch defaults
                  </Button>
                </div>

                <ScrollArea className="h-64 rounded-md border p-3">
                  <div className="space-y-4">
                    {recipients.map((c) => {
                      const state = candidateOverrides[c.id] ?? {
                        isScheduled: false,
                        scheduledDate,
                        validityPreset: "7_days",
                        customExpiry,
                      };
                      const cSchedIso = state.isScheduled && state.scheduledDate ? new Date(state.scheduledDate).toISOString() : null;
                      const cExpIso = computeExpiresAt(state.isScheduled ? state.scheduledDate : null, state.validityPreset, state.customExpiry);
                      const cNotice = formatScheduleNotice(cSchedIso, cExpIso);

                      return (
                        <div key={c.id} className="rounded-lg border bg-background p-3 text-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-semibold text-sm">{c.name}</span>
                              <span className="text-muted-foreground ml-2">({c.email ?? c.phone ?? "no contact"})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Schedule</span>
                              <Switch
                                checked={state.isScheduled}
                                onCheckedChange={(v) => updateCandidate(c.id, { isScheduled: v })}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {state.isScheduled && (
                              <div>
                                <Label className="text-[11px] text-muted-foreground">Date & Time</Label>
                                <Input
                                  type="datetime-local"
                                  value={state.scheduledDate}
                                  onChange={(e) => updateCandidate(c.id, { scheduledDate: e.target.value })}
                                  className="h-8 text-xs mt-1"
                                />
                              </div>
                            )}

                            <div>
                              <Label className="text-[11px] text-muted-foreground">Validity Window</Label>
                              <select
                                value={state.validityPreset}
                                onChange={(e) => updateCandidate(c.id, { validityPreset: e.target.value as ValidityPreset })}
                                className="h-8 w-full rounded-md border bg-background px-2 text-xs mt-1"
                              >
                                <option value="7_days">Whole week (7 days)</option>
                                <option value="1_day">Single day (24 hours)</option>
                                <option value="custom">Custom date & time</option>
                                <option value="none">No expiration</option>
                              </select>
                            </div>
                          </div>

                          {state.validityPreset === "custom" && (
                            <div>
                              <Label className="text-[11px] text-muted-foreground">Expires at</Label>
                              <Input
                                type="datetime-local"
                                value={state.customExpiry}
                                onChange={(e) => updateCandidate(c.id, { customExpiry: e.target.value })}
                                className="h-8 text-xs mt-1 w-full sm:w-60"
                              />
                            </div>
                          )}

                          <div className="text-[11px] text-muted-foreground italic pt-1 border-t">
                            Notice: &ldquo;{cNotice}&rdquo;
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          {(missingEmail > 0 || missingPhone > 0) && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {missingEmail > 0 && <li>• {missingEmail} without an email will be skipped for email.</li>}
              {missingPhone > 0 && <li>• {missingPhone} without a phone + country code will be skipped for WhatsApp.</li>}
            </ul>
          )}

          {recipients.length > 1 && (
            <div className="flex items-center gap-2">
              <Checkbox id="only-unsent" checked={onlyUnsent} onCheckedChange={(v) => setOnlyUnsent(v === true)} />
              <Label htmlFor="only-unsent" className="text-sm font-normal">
                Skip candidates already sent on that channel
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={blocked || send.isLoading || recipients.length === 0}
            onClick={handleSend}
          >
            {send.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send Invites
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
