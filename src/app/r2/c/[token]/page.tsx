"use client";

import "@livekit/components-styles";
import { CandidateFeedbackCard } from "@/components/round-two/candidate-feedback";
import { BoardSurfaces, CandidateTaskCard, useRoundTwoBoards, type BoardControls } from "@/components/round-two/room/boards";
import { TaskHistory } from "@/components/round-two/room/task-history";
import { useToast } from "@/hooks/use-toast";
import { AudioUnlock, LK_THEME } from "@/components/round-two/room/lk-theme";
import { RoomControls, useStartScreenShare } from "@/components/round-two/room/controls";
import { VideoStage } from "@/components/round-two/room/stage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  useDataChannel,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import { isServerPacket, type BoardKind, type BoardReplay } from "@/lib/round-two/boards";
import { R2_ROOM_OPTIONS, r2CameraCapture } from "@/lib/round-two/media";
import { DATA_TOPICS } from "@/lib/round-two/types";
import { Loader2, MonitorUp } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Info = {
  title: string;
  status: string;
  scheduledAt: string | null;
  durationMin: number;
  candidateName: string;
  organizationName: string;
  videoReady: boolean;
  feedbackGiven?: boolean;
};

export default function CandidateRoundTwoPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [joining, setJoining] = useState(false);
  const [conn, setConn] = useState<{ url: string; token: string; choices: LocalUserChoices } | null>(null);
  const [left, setLeft] = useState(false);

  useEffect(() => {
    fetch(`/api/round-two/candidate?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "This interview link is not valid");
        setInfo(body as Info);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const join = async (choices: LocalUserChoices) => {
    setJoining(true);
    setError(null);
    try {
      const r = await fetch("/api/round-two/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, consent: true }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Couldn't join");
      setConn({ url: body.url, token: body.token, choices });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join");
    } finally {
      setJoining(false);
    }
  };

  if (left) return <LeftScreen token={token} />;

  if (conn) {
    return (
      <LiveKitRoom
        serverUrl={conn.url}
        token={conn.token}
        connect
        options={R2_ROOM_OPTIONS}
        audio={false}
        video={false}
        onDisconnected={() => setLeft(true)}
        className="!h-[100dvh] overflow-hidden !bg-background text-foreground"
      >
        <CandidateRoom choices={conn.choices} linkToken={token} />
        <RoomAudioRenderer />
        <AudioUnlock />
      </LiveKitRoom>
    );
  }

  if (!info) {
    return <Centered>{error ? <p className="text-sm text-muted-foreground">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}</Centered>;
  }

  const when = info.scheduledAt ? new Date(info.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const closed = info.status !== "scheduled" && info.status !== "live";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
      <div className="max-w-lg text-center">
        <h1 className="text-xl font-bold">Hi {info.candidateName}</h1>
        <p className="text-sm text-muted-foreground">
          {info.organizationName ? `${info.organizationName} · ` : ""}
          {info.title}
          {when ? ` · ${when}` : ""}
        </p>
      </div>
      {closed ? (
        info.status === "ended" ? (
          <>
            <p className="text-sm text-muted-foreground">This interview has ended. Thank you for your time!</p>
            {!info.feedbackGiven && <CandidateFeedbackCard token={token} />}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This interview is not open.</p>
        )
      ) : !info.videoReady ? (
        <p className="text-sm text-muted-foreground">Video isn&apos;t available right now. Please try again in a few minutes.</p>
      ) : (
        <>
          <p className="max-w-lg text-center text-sm text-muted-foreground">
            Check your camera and microphone below. Use a quiet place and a laptop if you can.
          </p>
          <label className="flex max-w-lg items-start gap-2 rounded-lg border bg-card p-3 text-sm text-card-foreground">
            <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>
              I understand this interview is conducted live by the hiring team and that the conversation is transcribed with
              AI assistance to help the panel take notes and write their evaluation.
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className={consent ? "w-full max-w-lg overflow-hidden rounded-xl" : "pointer-events-none w-full max-w-lg overflow-hidden rounded-xl opacity-50"} {...LK_THEME}>
            <PreJoin
              defaults={{ username: info.candidateName }}
              userLabel="Your name"
              joinLabel={joining ? "Joining…" : "Join interview"}
              persistUserChoices
              onSubmit={(choices) => void join(choices)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** After leaving: if the interview has ended, a short optional feedback form; otherwise the rejoin note. */
function LeftScreen({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  useEffect(() => {
    fetch(`/api/round-two/candidate?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Info>) : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [token]);
  if (info === undefined) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Centered>;
  if (info?.status === "ended") {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Thanks for your time</h1>
        <p className="text-sm text-muted-foreground">The interview has ended. The hiring team will be in touch.</p>
        {!info.feedbackGiven && <CandidateFeedbackCard token={token} />}
      </Centered>
    );
  }
  return (
    <Centered>
      <h1 className="text-xl font-bold">Thanks for your time</h1>
      <p className="text-sm text-muted-foreground">You&apos;ve left the interview. If this was a mistake, reopen your link to rejoin.</p>
      <Button onClick={() => window.location.reload()}>Rejoin</Button>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">{children}</div>;
}

const BOARD_API = "/api/round-two/candidate/board";

/** Lobby until the host admits (publish permission arrives), then the call. */
function CandidateRoom({ choices, linkToken }: { choices: LocalUserChoices; linkToken: string }) {
  const room = useRoomContext();
  const perms = useLocalParticipantPermissions();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const admitted = perms?.canPublish === true;
  const loadReplay = useCallback(async (): Promise<BoardReplay | null> => {
    const res = await fetch(`${BOARD_API}?token=${encodeURIComponent(linkToken)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as BoardReplay) : null;
  }, [linkToken]);
  const persist = useCallback(
    (kind: BoardKind, taskId: string, data: string, keepalive: boolean) =>
      fetch(BOARD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: linkToken, kind, taskId, data }),
        // keepalive bodies are capped at 64 KB by browsers; bigger flushes rely on the last throttled save.
        keepalive: keepalive && data.length < 60_000,
      }).then((r) => {
        if (!r.ok && r.status !== 409) throw new Error(String(r.status));
      }),
    [linkToken],
  );
  const boards = useRoundTwoBoards({ side: "candidate", enabled: admitted, loadReplay, persist });
  const startShare = useStartScreenShare();
  const { toast } = useToast();
  const controls = useRef<BoardControls>({});
  const [submitting, setSubmitting] = useState(false);
  const task = boards.state.task;
  const taskId = task?.id ?? null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    // A task arrives (or was already open when we joined): tell the candidate once.
    if (!admitted || !taskId || announced.current === taskId) return;
    announced.current = taskId;
    toast({ title: "New task from your interviewer", description: "It's open on your screen." });
  }, [admitted, taskId, toast]);
  const submit = async () => {
    if (!task) return;
    setSubmitting(true);
    try {
      let data: string | null;
      let preview: string | undefined;
      if (task.kind === "coding") data = controls.current.coding?.() ?? null;
      else {
        const w = await controls.current.whiteboard?.();
        data = w?.data ?? null;
        preview = w?.preview ?? undefined;
      }
      if (!data) {
        toast({ title: "Nothing to submit yet", description: task.kind === "coding" ? "Write some code first." : "Draw something first." });
        return;
      }
      const res = await fetch(BOARD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: linkToken, kind: task.kind, taskId: task.id, data, submit: true, runOutput: controls.current.lastRun?.() ?? undefined, preview }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't submit");
      boards.setState(body.state);
      toast({ title: "Answer submitted ✓", description: "The interviewers can see it now." });
    } catch (e) {
      toast({ title: "Couldn't submit", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };
  const [shareAsk, setShareAsk] = useState<string | null>(null);
  useDataChannel(DATA_TOPICS.shareRequest, (msg) => {
    if (!isServerPacket(msg.from)) return;
    try {
      const by = (JSON.parse(new TextDecoder().decode(msg.payload)) as { by?: unknown }).by;
      setShareAsk(typeof by === "string" && by ? by : "The interviewer");
    } catch {
      setShareAsk("The interviewer");
    }
  });
  useEffect(() => {
    if (isScreenShareEnabled) setShareAsk(null);
  }, [isScreenShareEnabled]);
  const published = useRef(false);

  useEffect(() => {
    if (!admitted || published.current) return;
    published.current = true;
    void localParticipant.setMicrophoneEnabled(choices.audioEnabled, choices.audioEnabled ? { deviceId: choices.audioDeviceId } : undefined);
    void localParticipant.setCameraEnabled(
      choices.videoEnabled,
      choices.videoEnabled ? r2CameraCapture(choices.videoDeviceId) : undefined,
    );
  }, [admitted, choices, localParticipant]);

  if (!admitted) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <h1 className="text-lg font-semibold">Waiting for the interviewer to let you in</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Please keep this tab open. You&apos;ll join automatically.</p>
        <Button variant="outline" onClick={() => void room.disconnect()}>
          Leave
        </Button>
      </Centered>
    );
  }

  const boardsOpen = !!task && (boards.state.coding || boards.state.whiteboard);
  const banner = shareAsk && (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <span>
        <strong>{shareAsk}</strong> asked you to share your screen. Pick the window you&apos;re working in.
      </span>
      <span className="flex gap-2">
        <Button size="sm" onClick={() => void startShare()}>
          <MonitorUp className="mr-1.5 h-4 w-4" /> Share screen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShareAsk(null)}>
          Not now
        </Button>
      </span>
    </div>
  );

  if (boardsOpen && task) {
    // Working layout: video stays visible as a small tile beside the question; the board gets the room.
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-3 lg:overflow-hidden">
        {banner}
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <VideoStage className="h-32 min-h-0 flex-none lg:h-40" />
            <CandidateTaskCard task={task} status={boards.state.status} submitting={submitting} onSubmit={() => void submit()} className="min-h-[200px] flex-1" />
            <TaskHistory items={boards.history} activeId={task.id} className="max-h-24 shrink-0 overflow-auto" />
            <RoomControls onLeave={() => void room.disconnect()} />
          </div>
          <BoardSurfaces
            state={boards.state}
            writer
            showTask={false}
            onSnapshot={boards.publishSnapshot}
            remoteCoding={boards.remoteCoding}
            remoteWhiteboard={boards.remoteWhiteboard}
            roundTwo={{ token: linkToken }}
            controls={controls}
            className="min-h-[420px] lg:min-h-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
      {banner}
      <VideoStage className="min-h-[240px] flex-1" />
      <TaskHistory items={boards.history} className="max-h-24 shrink-0 overflow-auto" />
      <div className="shrink-0">
        <RoomControls onLeave={() => void room.disconnect()} />
      </div>
    </div>
  );
}
