"use client";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getSessionOverallScore } from "@/lib/session-score";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
    AlertTriangle,
    Briefcase,
    CalendarClock,
    Check,
    Copy,
    ExternalLink,
    GraduationCap,
    Loader2,
    Mail,
    MessageCircle,
    Pencil,
    Phone,
    Send,
    Sparkles,
    User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
    CandidateFormFields,
    EMPTY_CANDIDATE_FORM,
    formToCandidateInput,
    initials,
    parsedToForm,
    validateCandidateForm,
    type CandidateFormState,
} from "../interview/candidate-form";

/* eslint-disable @typescript-eslint/no-explicit-any */

function toForm(c: any): CandidateFormState {
  const f = parsedToForm({ ...c, skills: c.skills ?? [] }, { ...EMPTY_CANDIDATE_FORM, skills: [] });
  return { ...f, tailor: c.tailorInterview !== false };
}

function fmt(d?: string | null) {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime())
    ? d
    : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  IN_PROGRESS: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  ABANDONED: "bg-destructive/10 text-destructive border-destructive/20",
  DISQUALIFIED: "bg-destructive/10 text-destructive border-destructive/20",
};

function SendPill({ label, status, at }: { label: string; status?: string | null; at?: string | null }) {
  const cls =
    status === "sent"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)} title={fmt(at) ?? undefined}>
      {label}: {status ?? "not sent"}
    </span>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-sm">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 break-words", !value && "text-muted-foreground/60")}>{value || "—"}</span>
    </div>
  );
}

export function CandidateDetailSheet({
  candidateId,
  onOpenChange,
  onSaved,
  startInEdit = false,
}: {
  candidateId: string | null;
  /** Open directly in edit mode (row pencil icon). */
  startInEdit?: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const open = !!candidateId;
  const q = trpc.candidate.getById.useQuery({ id: candidateId ?? "" }, { enabled: open });
  const c = q.data as any;
  const delivery = trpc.candidate.deliveryOptions.useQuery(
    { interviewId: c?.interviewId ?? "" },
    { enabled: !!c?.interviewId },
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CandidateFormState>(EMPTY_CANDIDATE_FORM);
  const [confirmDiscard, setConfirmDiscard] = useState<null | "close" | "cancel">(null);
  const [copied, setCopied] = useState(false);

  const original = useMemo(() => (c ? toForm(c) : null), [c]);
  useEffect(() => {
    if (original && !editing) setForm(original);
  }, [original, editing]);
  useEffect(() => {
    setEditing(open && startInEdit);
  }, [open, startInEdit, candidateId]);

  const dirty = editing && !!original && JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const errors = validateCandidateForm(form);
  const sessionStatus: string = c?.session?.status ?? "NOT_STARTED";
  const started = !!c?.session && sessionStatus !== "NOT_STARTED";
  const score = c?.session?.insights ? getSessionOverallScore(c.session.insights) : null;
  const link = c?.inviteToken && typeof window !== "undefined" ? `${window.location.origin}/i/invite/${c.inviteToken}` : null;
  const tailored: { text: string; skill?: string | null }[] = Array.isArray(c?.tailoredQuestions) ? c.tailoredQuestions : [];

  const update = trpc.candidate.update.useMutation({
    onSuccess: (data: any) => {
      toast({
        title: "Session updated",
        description: data?.retailored ? "Tailored questions refreshed from the new skills." : undefined,
      });
      setEditing(false);
      void utils.candidate.getById.invalidate({ id: candidateId ?? "" });
      onSaved();
    },
    onError: (err) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const resend = trpc.candidate.resendInvite.useMutation({
    onSuccess: (d) => {
      const parts: string[] = [];
      let fail = false;
      for (const [ch, label] of [["whatsapp", "WhatsApp"], ["email", "Email"]] as const) {
        const r = d[ch];
        if (!r) continue;
        if (r.status !== "sent") fail = true;
        parts.push(`${label}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
      toast({ title: fail ? "Some messages not sent" : "Invite link sent", description: parts.join(" · ") || "Nothing to send", variant: fail ? "destructive" : undefined });
      void utils.candidate.getById.invalidate({ id: candidateId ?? "" });
      onSaved();
    },
    onError: (err) => toast({ title: "Resend failed", description: err.message, variant: "destructive" }),
  });

  const save = () => {
    if (!candidateId || Object.keys(errors).length) return;
    const input = formToCandidateInput(form);
    update.mutate({
      id: candidateId,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
      gender: input.gender ?? "",
      birthday: input.birthday ?? "",
      education: input.education ?? "",
      school: input.school ?? "",
      major: input.major ?? "",
      graduationYear: input.graduationYear,
      workExperience: input.workExperience ?? "",
      notes: input.notes ?? "",
      skills: input.skills,
      tailorInterview: input.tailorInterview,
    });
  };

  const requestClose = (next: boolean) => {
    if (!next && dirty) return setConfirmDiscard("close");
    onOpenChange(next);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl">
          <SheetHeader className="border-b bg-gradient-to-br from-primary/10 via-background to-background p-5 text-left">
            {q.isLoading || !c ? (
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-lg">{c.name}</SheetTitle>
                  <SheetDescription className="truncate">{c.interview?.title}</SheetDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[sessionStatus] ?? "bg-muted text-muted-foreground")}>
                      {sessionStatus.replace("_", " ").toLowerCase()}
                    </span>
                    {score != null && <Badge variant="outline" className="text-[11px]">Score {Math.round(score)}</Badge>}
                    <SendPill label="WhatsApp" status={c.whatsappStatus} at={c.whatsappSentAt} />
                    <SendPill label="Email" status={c.emailStatus} at={c.emailSentAt} />
                  </div>
                </div>
                {!editing && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-5 code-scrollbar">
            {q.isError && <p className="text-sm text-destructive">{q.error.message}</p>}
            {c && editing && (
              <div className="space-y-3">
                {started && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This interview is already {sessionStatus === "COMPLETED" ? "completed" : "in progress"}. Changes update the
                    candidate record but won&apos;t change answers or the report already recorded.
                  </div>
                )}
                <CandidateFormFields form={form} setForm={setForm} idPrefix="edit-" errors={Object.keys(errors).length ? errors : {}} />
              </div>
            )}
            {c && !editing && (
              <div className="space-y-4">
                {/* Invite link */}
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <h4 className="mb-2 text-sm font-semibold">Invite link</h4>
                  {link ? (
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{link}</code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard.writeText(link);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        disabled={resend.isLoading || !(delivery.data?.email || delivery.data?.whatsapp)}
                        title={delivery.data?.email || delivery.data?.whatsapp ? "Send the link again" : "Configure WhatsApp/Email in Integrations"}
                        onClick={() =>
                          resend.mutate({
                            candidateId: c.id,
                            channels: { email: !!delivery.data?.email && !!c.email, whatsapp: !!delivery.data?.whatsapp && !!c.phone },
                          })
                        }
                      >
                        {resend.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                        Resend
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No invite link.</p>
                  )}
                  {c.lastSendError && <p className="mt-2 text-xs text-destructive">Last send error: {c.lastSendError}</p>}
                </section>

                {/* Details */}
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <h4 className="mb-1 text-sm font-semibold">Candidate</h4>
                  <Row icon={Mail} label="Email" value={c.email} />
                  <Row icon={Phone} label="Phone" value={c.phone} />
                  <Row icon={User} label="Gender / DOB" value={[c.gender, c.birthday].filter(Boolean).join(" · ")} />
                  <Row icon={GraduationCap} label="Education" value={[c.education, c.major, c.school, c.graduationYear].filter(Boolean).join(" · ")} />
                  <Row icon={Briefcase} label="Experience" value={c.workExperience} />
                  <Row icon={MessageCircle} label="Notes" value={c.notes} />
                </section>

                {/* Schedule */}
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <h4 className="mb-1 text-sm font-semibold">Schedule & status</h4>
                  <Row icon={CalendarClock} label="Created" value={fmt(c.createdAt)} />
                  <Row icon={CalendarClock} label="Scheduled" value={fmt(c.scheduledAt)} />
                  <Row icon={CalendarClock} label="Link expires" value={fmt(c.expiresAt)} />
                  <Row icon={CalendarClock} label="Started" value={fmt(c.session?.startedAt ?? c.session?.createdAt)} />
                  <Row icon={CalendarClock} label="Completed" value={fmt(c.session?.completedAt)} />
                  {started && (
                    <a
                      href={`/interviews/${c.interviewId}/edit/sessions?session=${c.session.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open report <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </section>

                {/* Skills & tailoring */}
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Skills & tailored questions
                    </h4>
                    <span className="text-[11px] text-muted-foreground">Tailoring {c.tailorInterview === false ? "off" : "on"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(c.skills ?? []).length ? (
                      (c.skills as string[]).map((s) => (
                        <span key={s} className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No skills saved.</span>
                    )}
                  </div>
                  {tailored.length > 0 && (
                    <ol className="mt-3 space-y-1.5 text-sm">
                      {tailored.map((t, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">T{i + 1}</span>
                          <span>
                            {t.text}
                            {t.skill && <span className="ml-1 text-[11px] text-muted-foreground">({t.skill})</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            )}
          </div>

          {editing && (
            <div className="flex items-center justify-between gap-2 border-t bg-background/95 p-4">
              <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "No changes"}</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => (dirty ? setConfirmDiscard("cancel") : setEditing(false))}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={!dirty || update.isLoading || Object.keys(errors).length > 0}>
                  {update.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDiscard} onOpenChange={(o) => !o && setConfirmDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to this session will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const which = confirmDiscard;
                setConfirmDiscard(null);
                setEditing(false);
                if (original) setForm(original);
                if (which === "close") onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
