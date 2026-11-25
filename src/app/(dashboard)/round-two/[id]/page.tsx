"use client";

import { CopyField } from "@/components/round-two/create-round-two-sheet";
import { PlanChat } from "@/components/round-two/plan-chat";
import { PlanEditor } from "@/components/round-two/plan-editor";
import { AiRunHistory } from "@/components/ai/reasoning-timeline";
import { RoundTwoReportView } from "@/components/round-two/report-view";
import { RoundTwoStatusBadge } from "@/components/round-two/status-badge";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { QuestionPlanItem, RoundTwoReport } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import { ArrowLeft, Link2, Loader2, RefreshCw, Sparkles, UserPlus, Video, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not set";
}

export default function RoundTwoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const q = trpc.roundTwo.get.useQuery(
    { id },
    { refetchInterval: (d) => (d?.round.reportStatus === "pending" || d?.round.reportStatus === "generating" || d?.round.status === "live" ? 8000 : false) },
  );
  const live = trpc.roundTwo.live.useQuery({ id }, { enabled: q.data?.round.status === "ended" });
  const [plan, setPlan] = useState<QuestionPlanItem[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [email, setEmail] = useState("");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; link: string }[]>([]);
  const [confirm, setConfirm] = useState<"end" | "cancel" | null>(null);

  useEffect(() => {
    if (q.data && !planDirty) setPlan(q.data.round.questionPlan);
  }, [q.data, planDirty]);

  const onErr = (err: { message: string }) => toast({ title: "Failed", description: err.message, variant: "destructive" });
  const refresh = () => void utils.roundTwo.get.invalidate({ id });
  const savePlan = trpc.roundTwo.updatePlan.useMutation({
    onSuccess: () => {
      setPlanDirty(false);
      refresh();
      toast({ title: "Plan saved" });
    },
    onError: onErr,
  });
  const invite = trpc.roundTwo.invite.useMutation({
    onSuccess: (r) => {
      setEmail("");
      setInviteLinks((l) => [...l, ...r.invites.map((i) => ({ email: i.email, link: i.link }))]);
      refresh();
    },
    onError: onErr,
  });
  const revoke = trpc.roundTwo.revokeParticipant.useMutation({ onSuccess: refresh, onError: onErr });
  const shareLinks = trpc.roundTwo.ensureShareLinks.useMutation({ onError: onErr });
  const rotate = trpc.roundTwo.rotateCandidateLink.useMutation({
    onSuccess: (r) => {
      setNewLink(r.candidateLink);
      shareLinks.mutate({ id });
    },
    onError: onErr,
  });
  const end = trpc.roundTwo.end.useMutation({ onSuccess: refresh, onError: onErr });
  const cancel = trpc.roundTwo.cancel.useMutation({ onSuccess: refresh, onError: onErr });
  const retry = trpc.roundTwo.retryReport.useMutation({ onSuccess: refresh, onError: onErr });

  if (q.isLoading) return <Skeleton className="mx-auto h-96 max-w-5xl" />;
  if (!q.data) {
    return <p className="mx-auto max-w-5xl text-sm text-muted-foreground">{q.error?.message ?? "Not found"}</p>;
  }
  const { round, candidate, participants, canManage } = q.data;
  const open = ["draft", "scheduled", "live"].includes(round.status);
  const joinable = round.status === "scheduled" || round.status === "live";
  const report = round.report as RoundTwoReport | null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/round-two" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Round 2
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{candidate?.name ?? "Candidate"}</h1>
            <RoundTwoStatusBadge status={round.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {round.title} · {fmt(round.scheduledAt)} · {round.durationMin} min
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {joinable && (
            <Button asChild disabled={!q.data.liveKitConfigured}>
              <Link href={`/r2/${round.id}/room`}>
                <Video className="mr-1.5 h-4 w-4" />
                {round.status === "live" ? "Rejoin room" : "Start / join room"}
              </Link>
            </Button>
          )}
          {canManage && round.status === "live" && (
            <Button variant="destructive" onClick={() => setConfirm("end")}>
              End interview
            </Button>
          )}
          {canManage && open && round.status !== "live" && (
            <Button variant="outline" onClick={() => setConfirm("cancel")}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {!q.data.liveKitConfigured && joinable && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-600/5 p-3 text-sm">
          Live video isn&apos;t configured on this server yet (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).
        </p>
      )}

      {round.status === "ended" && (
        <div className="space-y-3">
          {round.reportStatus === "ready" && report ? (
            <RoundTwoReportView report={report} />
          ) : round.reportStatus === "failed" ? (
            <Card>
              <CardContent className="flex items-center justify-between gap-4 p-5 text-sm">
                <span>Report generation failed.</span>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => retry.mutate({ id })} disabled={retry.isLoading}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> The report is being generated in the background. You&apos;ll get an email when it&apos;s ready.
              </CardContent>
            </Card>
          )}
          <AiRunHistory
            subjectType="round_two"
            subjectId={id}
            flows={["round2-report"]}
            limit={1}
            live={round.reportStatus === "pending" || round.reportStatus === "generating"}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Question plan</CardTitle>
            {canManage && open && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowChat((v) => !v)}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {showChat ? "Hide AI" : "Edit with AI"}
                </Button>
                {planDirty && (
                  <Button size="sm" onClick={() => savePlan.mutate({ id, plan: plan.filter((p) => p.text.trim()) })} disabled={savePlan.isLoading}>
                    Save
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {showChat && (
              <div className="h-[380px] rounded-lg border p-3">
                <PlanChat
                  roundTwoId={id}
                  durationMin={round.durationMin}
                  onPlan={(p) => {
                    setPlan(p);
                    setPlanDirty(false);
                    refresh();
                  }}
                />
              </div>
            )}
            <PlanEditor
              plan={plan}
              readOnly={!canManage || !open}
              onChange={(p) => {
                setPlan(p);
                setPlanDirty(true);
              }}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Panel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.name || p.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.role} · {p.status}
                    </div>
                  </div>
                  {canManage && p.role !== "host" && open && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => revoke.mutate({ id, participantId: p.id })} aria-label="Remove">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {canManage && open && (
                <div className="flex gap-1.5 pt-1">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" className="h-8 text-sm" />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={invite.isLoading || !email.includes("@")}
                    onClick={() => invite.mutate({ id, people: [{ email: email.trim(), role: "interviewer" }] })}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {inviteLinks.map((l) => (
                <CopyField key={l.email} label={l.email} value={l.link} />
              ))}
            </CardContent>
          </Card>

          {canManage && open && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Invite links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Candidate link for the interviewee; partner link for any panelist to join. Rotating the candidate
                  link disables the previous one.
                </p>
                {(newLink || shareLinks.data) && (
                  <>
                    <CopyField label="Candidate" value={(newLink ?? shareLinks.data?.candidateLink)!} />
                    {shareLinks.data?.partnerLink && (
                      <CopyField label="Partner / panelist" value={shareLinks.data.partnerLink} />
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => shareLinks.mutate({ id })}
                    disabled={shareLinks.isLoading}
                  >
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                    {shareLinks.data || newLink ? "Refresh links" : "Show links"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => rotate.mutate({ id })} disabled={rotate.isLoading}>
                    Rotate candidate link
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {q.data.scorecards.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Scorecards</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {q.data.scorecards.map((s) => (
                  <div key={s.id as string}>
                    <span className="font-medium">{(s.userName as string) || "Interviewer"}</span>
                    <span className="text-muted-foreground"> · {String(s.recommendation ?? "").replace("_", " ")}</span>
                    {s.comments ? <p className="text-xs text-muted-foreground">{s.comments as string}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {round.status === "ended" && (live.data?.transcript.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Transcript</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[480px] space-y-1.5 overflow-y-auto text-sm">
            {live.data!.transcript.map((s) => (
              <p key={s.id as string}>
                <span className="font-medium">{s.speakerRole === "candidate" ? "Candidate" : (s.speakerName as string) || "Interviewer"}:</span>{" "}
                {s.text as string}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "end" ? "End the interview for everyone?" : "Cancel this round 2?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "end"
                ? "Everyone is disconnected and the report starts generating in the background."
                : "The candidate and panel links stop working."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === "end") end.mutate({ id });
                else cancel.mutate({ id });
                setConfirm(null);
              }}
            >
              {confirm === "end" ? "End interview" : "Cancel interview"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
