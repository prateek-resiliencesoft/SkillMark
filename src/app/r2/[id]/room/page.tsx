"use client";

import "@livekit/components-styles";
import { AudioUnlock, LK_THEME } from "@/components/round-two/room/lk-theme";
import { BoardSurfaces, TaskToolbar, useRoundTwoBoards } from "@/components/round-two/room/boards";
import { CodingTaskDialog } from "@/components/round-two/room/coding-task-dialog";
import { TaskAnswers, TaskHistory } from "@/components/round-two/room/task-history";
import { PanelSidebar, ScorecardTab } from "@/components/round-two/room/panel-sidebar";
import { RoomControls } from "@/components/round-two/room/controls";
import { RoomShareLinks } from "@/components/round-two/room/share-links";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { canControlBoards, isServerPacket, type BoardKind, type CodingTask } from "@/lib/round-two/boards";
import { R2_ROOM_OPTIONS, r2CameraCapture } from "@/lib/round-two/media";
import { CANDIDATE_IDENTITY_PREFIX, DATA_TOPICS } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  useDataChannel,
  useRemoteParticipants,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import { Loader2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Isolated so the 1s tick does not re-render LiveKit video / sidebar. */
function ElapsedBadge({ startedAt, durationMin }: { startedAt: string | null | undefined; durationMin: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const remaining = durationMin * 60 - elapsed;
  return (
    <div className="text-right text-xs tabular-nums">
      <div className="font-semibold">{mmss(elapsed)}</div>
      <div className={remaining < 0 ? "text-destructive" : "text-muted-foreground"}>
        {remaining < 0 ? `${mmss(-remaining)} over` : `${mmss(remaining)} left`}
      </div>
    </div>
  );
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 overflow-auto p-6 text-center">
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
            <div className="mb-1 font-semibold">{myScorecard?.submittedAt ? "Your feedback on the candidate" : "Give your feedback on the candidate"}</div>
            <p className="mb-3 text-xs text-muted-foreground">Rating, recommendation, strengths and concerns. It goes into the report.</p>
            <ScorecardTab roundTwoId={id} initial={myScorecard as Record<string, unknown> | null} />
          </div>
        )}
      </div>
    );
  }

  if (!conn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
        <div className="text-center">
          <h1 className="text-xl font-bold">{candidate?.name ?? "Candidate"} · round 2</h1>
          <p className="text-sm text-muted-foreground">{round.title}</p>
          {!info.data.liveKitConfigured && <p className="mt-2 text-sm text-destructive">Live video is not configured on this server.</p>}
        </div>
        <div className="w-full max-w-lg overflow-hidden rounded-xl" {...LK_THEME}>
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
      options={R2_ROOM_OPTIONS}
      audio={conn.choices.audioEnabled ? { deviceId: conn.choices.audioDeviceId } : false}
      video={conn.choices.videoEnabled ? r2CameraCapture(conn.choices.videoDeviceId) : false}
      onDisconnected={() => {
        void info.refetch().then((r) => setLeft(r.data?.round.status === "live" ? "left" : "ended"));
      }}
      onError={(err) => toast({ title: "Connection problem", description: err.message, variant: "destructive" })}
      className="!h-[100dvh] overflow-hidden !bg-background text-foreground"
    >
      <PanelRoom id={id} />
      <RoomAudioRenderer />
      <AudioUnlock />
    </LiveKitRoom>
  );
}

function PanelRoom({ id }: { id: string }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const room = useRoomContext();
  const boards = useRoundTwoBoards({
    side: "panel",
    loadReplay: () => utils.roundTwo.board.fetch({ id }, { staleTime: 0 }),
  });
  const [taskDialog, setTaskDialog] = useState<BoardKind | null>(null);
  const [answersOpen, setAnswersOpen] = useState(false);
  const info = trpc.roundTwo.get.useQuery(
    { id },
    { staleTime: 30_000, refetchOnWindowFocus: false, refetchOnMount: false },
  );
  // Poll slower; data-channel bumps are debounced so STT spam does not thrash React.
  const live = trpc.roundTwo.live.useQuery(
    { id },
    { refetchInterval: 12_000, refetchOnWindowFocus: false, staleTime: 4_000 },
  );
  const remotes = useRemoteParticipants();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const liveBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshLive = useCallback(() => {
    if (liveBumpTimer.current) return;
    liveBumpTimer.current = setTimeout(() => {
      liveBumpTimer.current = null;
      void utils.roundTwo.live.invalidate({ id });
    }, 2500);
  }, [id, utils.roundTwo.live]);
  useEffect(() => () => {
    if (liveBumpTimer.current) clearTimeout(liveBumpTimer.current);
  }, []);
  // Server-only topics: ignore anything a participant publishes on them.
  const onServerBump = useCallback((msg: { from?: unknown }) => {
    if (isServerPacket(msg.from as { identity?: string } | undefined)) refreshLive();
  }, [refreshLive]);
  useDataChannel(DATA_TOPICS.transcript, onServerBump);
  useDataChannel(DATA_TOPICS.copilot, onServerBump);

  const admit = trpc.roundTwo.admitCandidate.useMutation({
    onSuccess: () => {
      toast({ title: "Candidate admitted" });
      refreshLive();
    },
    onError: (err) => toast({ title: "Couldn't admit", description: err.message, variant: "destructive" }),
  });
  const give = trpc.roundTwo.giveTask.useMutation({
    onSuccess: (next) => {
      boards.setState(next);
      setTaskDialog(null);
      toast({ title: "Task sent", description: "It's open on the candidate's screen." });
    },
    onError: (err) => toast({ title: "Couldn't send the task", description: err.message, variant: "destructive" }),
  });
  const endTask = trpc.roundTwo.endTask.useMutation({
    onSuccess: (next) => {
      boards.setState(next);
      toast({ title: "Task ended" });
    },
    onError: (err) => toast({ title: "Couldn't end the task", description: err.message, variant: "destructive" }),
  });
  const answers = trpc.roundTwo.tasks.useQuery({ id }, { enabled: answersOpen, refetchOnWindowFocus: false });
  // The candidate pressed Submit (the server tells everyone through the board state).
  const seenStatus = useRef<string | null>(null);
  const taskKey = `${boards.state.task?.id ?? ""}:${boards.state.status ?? ""}`;
  useEffect(() => {
    if (seenStatus.current !== null && boards.state.status === "submitted" && seenStatus.current !== taskKey) {
      toast({ title: "Candidate submitted their answer ✓", description: boards.state.task?.title });
      void utils.roundTwo.tasks.invalidate({ id });
    }
    seenStatus.current = taskKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey]);
  const askShare = trpc.roundTwo.askToShare.useMutation({
    onSuccess: () => toast({ title: "Asked the candidate to share their screen" }),
    onError: (err) => toast({ title: "Couldn't ask", description: err.message, variant: "destructive" }),
  });
  const end = trpc.roundTwo.end.useMutation({
    onSuccess: () => void room.disconnect(),
    onError: (err) => toast({ title: "Couldn't end", description: err.message, variant: "destructive" }),
  });

  if (!info.data) return null;
  const { round, candidate, canManage, myRole, myScorecard } = info.data;
  const candidateP = remotes.find((p) => p.identity.startsWith(CANDIDATE_IDENTITY_PREFIX));
  const inLobby = !!candidateP && candidateP.permissions?.canSubscribe === false;
  const canControl = canControlBoards(myRole);
  const st = boards.state;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative flex min-h-0 min-w-0 flex-col gap-2 p-3">
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{candidate?.name ?? "Candidate"}</div>
            <div className="truncate text-xs text-muted-foreground">{round.title}</div>
          </div>
          <ElapsedBadge startedAt={live.data?.startedAt ?? round.startedAt} durationMin={round.durationMin} />
          {!candidateP && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Candidate not joined yet</span>}
          {canManage && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmEnd(true)}>
              End for all
            </Button>
          )}
        </div>

        {canManage && <RoomShareLinks roundTwoId={id} />}

        {inLobby && (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
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

        <VideoStage className={st.coding || st.whiteboard ? "min-h-[160px] flex-[0.55]" : "min-h-[240px] flex-1"} />
        <BoardSurfaces
          state={st}
          writer={false}
          onClose={canControl ? () => endTask.mutate({ id }) : undefined}
          remoteCoding={boards.remoteCoding}
          remoteWhiteboard={boards.remoteWhiteboard}
          className="min-h-[200px] flex-1"
        />
        {boards.history.length > 0 && (
          <div className="flex shrink-0 items-start gap-2">
            <TaskHistory items={boards.history} activeId={st.task?.id} className="max-h-20 min-w-0 flex-1 overflow-auto" />
            <Button type="button" size="sm" variant="outline" onClick={() => setAnswersOpen(true)}>
              View answers
            </Button>
          </div>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          {canControl && (
            <TaskToolbar
              state={st}
              busy={give.isLoading || endTask.isLoading}
              onGive={(kind) => setTaskDialog(kind)}
              onEnd={() => endTask.mutate({ id })}
              onAskShare={candidateP && !inLobby ? () => askShare.mutate({ id }) : undefined}
            />
          )}
          <RoomControls guardScreenShare canScreenShare={canControl} onLeave={() => void room.disconnect()} />
        </div>
      </div>

      <aside className="min-h-0 min-w-0 overflow-hidden border-t bg-card text-card-foreground lg:border-l lg:border-t-0">
        <PanelSidebar
          roundTwoId={id}
          plan={round.questionPlan}
          round1={round.round1Context}
          myRole={myRole}
          live={live.data}
          myScorecard={myScorecard as Record<string, unknown> | null}
          candidateId={candidate?.id}
          candidateName={candidate?.name}
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
            <AlertDialogAction onClick={() => end.mutate({ id, boards: boards.latestForFlush() })}>End interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canControl && taskDialog && (
        <CodingTaskDialog
          key={taskDialog}
          roundTwoId={id}
          kind={taskDialog}
          open
          onOpenChange={(o) => !o && setTaskDialog(null)}
          busy={give.isLoading}
          onPick={(task: CodingTask) => give.mutate({ id, task })}
        />
      )}

      <Dialog open={answersOpen} onOpenChange={setAnswersOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Candidate answers</DialogTitle>
            <DialogDescription>Every task given in this interview, with what the candidate wrote or drew.</DialogDescription>
          </DialogHeader>
          {answers.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <TaskAnswers items={answers.data ?? []} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
