"use client";

import { PlanChat } from "@/components/round-two/plan-chat";
import { PlanEditor } from "@/components/round-two/plan-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  formatApprovalNextRoundDetails,
  formatDeclineDeliverySummary,
  type DeclineChannelOutcome,
} from "@/lib/messaging/templates";
import type { QuestionPlanItem } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import { Check, Copy, Loader2, Plus, Video, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Person = { email: string; role: "interviewer" | "observer" };
type ScheduleResult = {
  candidateLink: string;
  candidateDelivery: { status: string; error?: string };
  invites: { email: string; link: string; delivery: { status: string; error?: string } }[];
};

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      {label && <Label className="text-xs">{label}</Label>}
      <div className="flex gap-1.5">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Create a round 2: AI-built question plan, schedule, panel invites, candidate link. */
export function CreateRoundTwoSheet({
  open,
  onOpenChange,
  candidateId,
  sessionId,
  candidateName,
  /**
   * Create-Round-2-now path: do NOT approve until schedule succeeds.
   * On success → approve + shortlist with join link. On fail/dismiss → nothing.
   */
  approveAndNotifyOnSchedule = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId?: string;
  sessionId?: string;
  candidateName?: string | null;
  approveAndNotifyOnSchedule?: boolean;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [plan, setPlan] = useState<QuestionPlanItem[]>([]);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });
  const [durationMin, setDurationMin] = useState(45);
  const [people, setPeople] = useState<Person[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Person["role"]>("interviewer");
  const [emailCandidate, setEmailCandidate] = useState(true);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const approvedRef = useRef(false);
  const approveFlagRef = useRef(approveAndNotifyOnSchedule);

  useEffect(() => {
    approveFlagRef.current = approveAndNotifyOnSchedule;
  }, [approveAndNotifyOnSchedule]);

  const approveMutation = trpc.session.setMediaReview.useMutation({
    onSuccess: (data) => {
      void utils.analysis.getSessionSummary.invalidate(
        sessionId ? { sessionId } : undefined,
      );
      void utils.session.listByInterview.invalidate();
      void utils.roundTwo.forCandidate.invalidate();
      void utils.roundTwo.projectRoundMeta.invalidate();
      const summary = formatDeclineDeliverySummary(
        "email" in data ? (data.email as DeclineChannelOutcome | undefined) : undefined,
        "whatsapp" in data ? (data.whatsapp as DeclineChannelOutcome | undefined) : undefined,
      );
      toast({
        title: "Approved — Round 2 scheduled",
        description: summary || undefined,
      });
    },
    onError: (err) =>
      toast({
        title: "Round 2 scheduled, but approve/shortlist failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  const draft = trpc.roundTwo.createDraft.useMutation({
    onSuccess: (d) => setRoundId(d.id),
    onError: (err) => {
      toast({ title: "Couldn't start round 2", description: err.message, variant: "destructive" });
      // Fail closed: no approve, no template.
      onOpenChange(false);
    },
  });
  const round = trpc.roundTwo.get.useQuery({ id: roundId ?? "" }, { enabled: !!roundId });
  const updatePlan = trpc.roundTwo.updatePlan.useMutation();
  const schedule = trpc.roundTwo.schedule.useMutation({
    onSuccess: (r) => {
      setResult(r);
      void utils.roundTwo.watchlist.invalidate();
      void utils.roundTwo.list.invalidate();
      void utils.roundTwo.forCandidate.invalidate();
      void utils.roundTwo.projectRoundMeta.invalidate();
      if (approveFlagRef.current && sessionId && !approvedRef.current) {
        approvedRef.current = true;
        approveMutation.mutate({
          sessionId,
          action: "approved",
          deferShortlist: false,
          nextRoundDetails: formatApprovalNextRoundDetails({
            scheduledAt: when ? new Date(when).toISOString() : null,
            durationMin,
            candidateLink: r.candidateLink,
          }),
        });
      }
    },
    onError: (err) => toast({ title: "Couldn't schedule", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (open && !roundId && !draft.isLoading && (candidateId || sessionId)) {
      draft.mutate({ candidateId, sessionId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidateId, sessionId]);

  useEffect(() => {
    if (!open) {
      setRoundId(null);
      setPlan([]);
      setResult(null);
      setPeople([]);
      approvedRef.current = false;
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    // Dismiss / fail before schedule → candidate stays unapproved, no template.
    onOpenChange(next);
  };

  const loaded = round.data?.round;
  useEffect(() => {
    if (!loaded) return;
    setTitle((t) => t || loaded.title);
    setPlan((p) => (p.length ? p : loaded.questionPlan));
    if (loaded.durationMin) setDurationMin(loaded.durationMin);
  }, [loaded]);

  const addPerson = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    if (!people.some((p) => p.email === e)) setPeople([...people, { email: e, role }]);
    setEmail("");
  };

  const submit = async () => {
    if (!roundId) return;
    const clean = plan.filter((q) => q.text.trim());
    if (clean.length === 0) {
      toast({ title: "Add at least one question", variant: "destructive" });
      return;
    }
    try {
      await updatePlan.mutateAsync({ id: roundId, plan: clean });
      schedule.mutate({
        id: roundId,
        title: title.trim() || "Round 2 interview",
        scheduledAt: when ? new Date(when).toISOString() : null,
        durationMin,
        interviewers: people,
        emailCandidate,
      });
    } catch (err) {
      toast({ title: "Couldn't save the plan", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const ctx = loaded?.round1Context;
  const busy = schedule.isLoading || updatePlan.isLoading;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Schedule round 2{candidateName ? ` · ${candidateName}` : ""}</SheetTitle>
          <SheetDescription>
            A live video interview with your panel. The AI builds questions from round 1, the CV and your instructions.
          </SheetDescription>
        </SheetHeader>

        {!roundId || round.isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading round 1 and preparing context…
          </div>
        ) : result ? (
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="rounded-lg border border-green-600/40 bg-green-600/5 p-4 text-sm">
              Round 2 scheduled.{" "}
              {result.candidateDelivery.status === "sent"
                ? "The candidate was emailed their link."
                : "Share the candidate link below (email was not sent" +
                  (result.candidateDelivery.error ? `: ${result.candidateDelivery.error}` : "") +
                  ")."}
            </div>
            <CopyField label="Candidate link (shown once; you can generate a new one later)" value={result.candidateLink} />
            {result.invites.length > 0 && (
              <div className="space-y-3">
                <Label className="text-xs">Panel invite links</Label>
                {result.invites.map((i) => (
                  <div key={i.email} className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {i.email} · {i.delivery.status === "sent" ? "emailed" : "not emailed, share manually"}
                    </div>
                    <CopyField value={i.link} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button asChild>
                <Link href={`/round-two/${roundId}`}>Open interview</Link>
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
            <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
              {ctx && (ctx.summary || ctx.weaknesses?.length) ? (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                  <div className="mb-1 font-semibold">
                    Round 1{ctx.overallScore != null ? ` · ${ctx.overallScore.toFixed(1)}/10` : ""}
                  </div>
                  {ctx.weaknesses?.length ? <div>Probe: {ctx.weaknesses.slice(0, 4).join("; ")}</div> : null}
                  {ctx.claims?.length ? <div className="mt-0.5 text-muted-foreground">{ctx.claims.length} claims to cross-check</div> : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_200px_110px]">
                <div className="space-y-1">
                  <Label className="text-xs">Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date and time</Label>
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Minutes</Label>
                  <Input
                    type="number"
                    min={10}
                    max={240}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Math.max(10, Math.min(240, Number(e.target.value) || 45)))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Panel (anyone with an email; they sign in with Google or an account)</Label>
                <div className="flex gap-2">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())}
                    placeholder="interviewer@company.com"
                  />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Person["role"])}
                    className="h-10 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="interviewer">Interviewer</option>
                    <option value="observer">Observer</option>
                  </select>
                  <Button variant="outline" onClick={addPerson}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {people.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <span key={p.email} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                        {p.email} · {p.role}
                        <button type="button" onClick={() => setPeople(people.filter((x) => x.email !== p.email))} aria-label="Remove">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={emailCandidate} onCheckedChange={(v) => setEmailCandidate(v === true)} />
                  Email the candidate their join link
                </label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Question plan</Label>
                <PlanEditor plan={plan} onChange={setPlan} />
              </div>
            </div>

            <div className="flex min-h-0 flex-col border-t p-4 lg:border-l lg:border-t-0">
              <div className="mb-2 text-sm font-semibold">AI question builder</div>
              <div className="min-h-[300px] flex-1">
                <PlanChat roundTwoId={roundId} durationMin={durationMin} onPlan={setPlan} autoStart={(loaded?.questionPlan.length ?? 0) === 0} />
              </div>
            </div>
          </div>
        )}

        {roundId && !result && !round.isLoading && (
          <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
            <Button
              variant="outline"
              onClick={() => {
                const clean = plan.filter((q) => q.text.trim());
                if (roundId && clean.length) updatePlan.mutate({ id: roundId, plan: clean });
                onOpenChange(false);
              }}
            >
              Save as draft
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Video className="mr-1.5 h-4 w-4" />}
              Schedule and send invites
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
