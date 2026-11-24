"use client";

import "@livekit/components-styles";
import { PanelSidebar, ScorecardTab } from "@/components/round-two/room/panel-sidebar";
import { RoomControls } from "@/components/round-two/room/controls";
import { VideoStage } from "@/components/round-two/room/stage";
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
import { useToast } from "@/hooks/use-toast";
import { CANDIDATE_IDENTITY_PREFIX, DATA_TOPICS } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  StartAudio,
  useDataChannel,
  useRemoteParticipants,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import { Loader2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

function useElapsed(startedAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PanelRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const info = trpc.roundTwo.get.useQuery({ id }, { refetchOnWindowFocus: false });
  const [conn, setConn] = useState<{ url: string; token: string; choices: LocalUserChoices } | null>(null);
  const [left, setLeft] = useState<"left" | "ended" | null>(null);
  const join = trpc.roundTwo.joinToken.useMutation({
    onError: (err) => toast({ title: "Couldn't join", description: err.message, variant: "destructive" }),
  });

  if (info.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!info.data) {
    return <div className="flex h-screen items-center justify-center p-6 text-sm text-muted-foreground">{info.error?.message ?? "Interview not found"}</div>;
  }
  const { round, candidate, canManage, myRole, myScorecard } = info.data;

  if (left) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">{left === "ended" ? "The interview has ended" : "You left the interview"}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {left === "ended" ? "The report is being generated in the background." : "You can rejoin while the interview is still running."}
        </p>
        <div className="flex gap-2">
          {left === "left" && (
            <Button
              onClick={() => {
                setLeft(null);
                setConn(null);
              }}
            >
              Rejoin
            </Button>
          )}
          {canManage && (
            <Button variant="outline" asChild>
              <Link href={`/round-two/${id}`}>Back to interview page</Link>
            </Button>
          )}
        </div>
        {myRole !== "observer" && (
          <div className="mt-4 w-full max-w-md rounded-xl border p-4 text-left">
            <div className="mb-3 font-semibold">{myScorecard?.submittedAt ? "Your scorecard" : "Submit your scorecard"}</div>
            <ScorecardTab roundTwoId={id} initial={myScorecard as Record<string, unknown> | null} />
          </div>
        )}
      </div>
    );
  }

  if (!conn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6" data-lk-theme="default">
        <div className="text-center">
          <h1 className="text-xl font-bold">{candidate?.name ?? "Candidate"} · round 2</h1>
          <p className="text-sm text-muted-foreground">{round.title}</p>
          {!info.data.liveKitConfigured && <p className="mt-2 text-sm text-destructive">Live video is not configured on this server.</p>}
        </div>
        <div className="w-full max-w-lg">
          <PreJoin
            defaults={{ username: info.data.participants.find((p) => p.role === info.data.myRole)?.name ?? "" }}
            joinLabel={join.isLoading ? "Joining…" : "Join interview"}
            userLabel="Your name"
            onSubmit={(choices) =>
              join.mutate(
                { id },
                {
                  onSuccess: (t) => setConn({ url: t.url, token: t.token, choices }),
                },
              )
            }
          />
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={conn.choices.audioEnabled ? { deviceId: conn.choices.audioDeviceId } : false}
      video={conn.choices.videoEnabled ? { deviceId: conn.choices.videoDeviceId } : false}
      onDisconnected={() => {
        void info.refetch().then((r) => setLeft(r.data?.round.status === "live" ? "left" : "ended"));
      }}
      onError={(err) => toast({ title: "Connection problem", description: err.message, variant: "destructive" })}
      className="h-screen"
      data-lk-theme="default"
    >
      <PanelRoom id={id} />
      <RoomAudioRenderer />
      <StartAudio label="Click to enable audio" />
    </LiveKitRoom>
  );
}

function PanelRoom({ id }: { id: string }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const room = useRoomContext();
  const info = trpc.roundTwo.get.useQuery({ id });
  const live = trpc.roundTwo.live.useQuery({ id }, { refetchInterval: 6000 });
  const remotes = useRemoteParticipants();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const elapsed = useElapsed(live.data?.startedAt ?? info.data?.round.startedAt);

  const refreshLive = () => void utils.roundTwo.live.invalidate({ id });
  useDataChannel(DATA_TOPICS.transcript, refreshLive);
  useDataChannel(DATA_TOPICS.copilot, refreshLive);

  const admit = trpc.roundTwo.admitCandidate.useMutation({
    onSuccess: () => {
      toast({ title: "Candidate admitted" });
      refreshLive();
    },
    onError: (err) => toast({ title: "Couldn't admit", description: err.message, variant: "destructive" }),
  });
  const end = trpc.roundTwo.end.useMutation({
    onSuccess: () => void room.disconnect(),
    onError: (err) => toast({ title: "Couldn't end", description: err.message, variant: "destructive" }),
  });

  if (!info.data) return null;
  const { round, candidate, canManage, myRole, myScorecard } = info.data;
  const candidateP = remotes.find((p) => p.identity.startsWith(CANDIDATE_IDENTITY_PREFIX));
  const inLobby = !!candidateP && candidateP.permissions?.canSubscribe === false;
  const remaining = elapsed != null ? round.durationMin * 60 - elapsed : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-background lg:grid-cols-[1fr_420px]">
      <div className="flex min-h-0 flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{candidate?.name ?? "Candidate"}</div>
            <div className="truncate text-xs text-muted-foreground">{round.title}</div>
          </div>
          {elapsed != null && (
            <div className="text-right text-xs tabular-nums">
              <div className="font-semibold">{mmss(elapsed)}</div>
              {remaining != null && (
                <div className={remaining < 0 ? "text-destructive" : "text-muted-foreground"}>
                  {remaining < 0 ? `${mmss(-remaining)} over` : `${mmss(remaining)} left`}
                </div>
              )}
            </div>
          )}
          {!candidateP && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Candidate not joined yet</span>}
          {canManage && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmEnd(true)}>
              End for all
            </Button>
          )}
        </div>

        {inLobby && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <span>
              <strong>{candidateP.name || "The candidate"}</strong> is waiting in the lobby.
            </span>
            {canManage ? (
              <Button size="sm" onClick={() => admit.mutate({ id })} disabled={admit.isLoading}>
                <UserCheck className="mr-1.5 h-4 w-4" /> Admit
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">The host will admit them.</span>
            )}
          </div>
        )}

        <VideoStage className="min-h-0 flex-1" />
        <RoomControls guardScreenShare onLeave={() => void room.disconnect()} />
      </div>

      <aside className="min-h-0 border-l bg-card">
        <PanelSidebar
          roundTwoId={id}
          plan={round.questionPlan}
          round1={round.round1Context}
          myRole={myRole}
          live={live.data}
          myScorecard={myScorecard as Record<string, unknown> | null}
        />
      </aside>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the interview for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone is disconnected. The report is generated in the background from the transcript, notes and scorecards
              (panelists can still submit scorecards afterwards).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => end.mutate({ id })}>End interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
