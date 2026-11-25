"use client";

import { useProject } from "@/components/project-provider";
import { CreateRoundTwoSheet } from "@/components/round-two/create-round-two-sheet";
import { RecommendationBadge, RoundTwoStatusBadge } from "@/components/round-two/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { CalendarDays, EyeOff, Users, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function RoundTwoPage() {
  const { currentProject } = useProject();
  const projectId = currentProject?.id;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const watchlist = trpc.roundTwo.watchlist.useQuery({ projectId: projectId ?? "" }, { enabled: !!projectId });
  const rounds = trpc.roundTwo.list.useQuery({ projectId: projectId ?? "" }, { enabled: !!projectId, refetchInterval: 20_000 });
  const dismiss = trpc.roundTwo.dismissFromWatchlist.useMutation({
    onSuccess: () => void utils.roundTwo.watchlist.invalidate(),
    onError: (err) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  const [target, setTarget] = useState<{ id: string; name: string; sessionId: string | null } | null>(null);

  const awaiting = (watchlist.data?.candidates ?? []).filter((c) => !c.roundTwo || ["draft", "cancelled", "no_show"].includes(c.roundTwo.status));
  const inFlight = (watchlist.data?.candidates ?? []).filter((c) => c.roundTwo && !["draft", "cancelled", "no_show"].includes(c.roundTwo.status));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Round 2</h1>
        <p className="text-muted-foreground">
          Live panel interviews for candidates you approved in round 1, with an AI copilot for the interviewers.
        </p>
      </div>

      <Tabs defaultValue="watchlist">
        <TabsList>
          <TabsTrigger value="watchlist">Watchlist ({awaiting.length})</TabsTrigger>
          <TabsTrigger value="interviews">Interviews ({rounds.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="watchlist" className="mt-4 space-y-3">
          {watchlist.isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : awaiting.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No approved candidates waiting</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Approve a candidate on their round 1 report and they appear here, ready for a round 2.
                </p>
              </CardContent>
            </Card>
          ) : (
            awaiting.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-[200px] flex-1">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.interviewTitle} · approved {fmt(c.approvedAt)}
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold">{c.round1Score != null ? c.round1Score.toFixed(1) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">Round 1</div>
                  </div>
                  {c.roundTwo && <RoundTwoStatusBadge status={c.roundTwo.status} />}
                  <div className="flex gap-2">
                    {c.sessionId && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/interviews/${c.interviewId}/results?session=${c.sessionId}`}>Round 1 report</Link>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setTarget({ id: c.id, name: c.name, sessionId: c.sessionId })}>
                      <Video className="mr-1.5 h-3.5 w-3.5" />
                      {c.roundTwo?.status === "draft" ? "Continue draft" : "Create round 2"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remove from watchlist"
                      disabled={dismiss.isLoading}
                      onClick={() => dismiss.mutate({ candidateId: c.id })}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
          {inFlight.length > 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              {inFlight.length} approved candidate{inFlight.length === 1 ? " has" : "s have"} a round 2 already; see the Interviews tab.
            </p>
          )}
        </TabsContent>

        <TabsContent value="interviews" className="mt-4 space-y-3">
          {rounds.isLoading ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : !rounds.data?.length ? (
            <Card>
              <CardContent className="py-14 text-center text-sm text-muted-foreground">No round 2 interviews yet.</CardContent>
            </Card>
          ) : (
            rounds.data.map((r) => (
              <Link key={r.id} href={`/round-two/${r.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-wrap items-center gap-4 p-4">
                    <div className="min-w-[200px] flex-1">
                      <p className="font-semibold">{r.candidate.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" /> {fmt(r.scheduledAt)} · {r.durationMin} min · {r.title}
                      </p>
                    </div>
                    <RoundTwoStatusBadge status={r.status} />
                    {r.reportStatus === "ready" ? (
                      <RecommendationBadge value={r.recommendation} />
                    ) : r.reportStatus === "pending" || r.reportStatus === "generating" ? (
                      <span className="text-xs text-muted-foreground">Report generating…</span>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>
      </Tabs>

      <CreateRoundTwoSheet
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        candidateId={target?.id}
        sessionId={target?.sessionId ?? undefined}
        candidateName={target?.name}
      />
    </div>
  );
}
