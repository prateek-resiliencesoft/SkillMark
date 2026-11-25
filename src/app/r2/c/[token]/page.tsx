"use client";

import "@livekit/components-styles";
import { RoomControls } from "@/components/round-two/room/controls";
import { VideoStage } from "@/components/round-two/room/stage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Info = {
  title: string;
  status: string;
  scheduledAt: string | null;
  durationMin: number;
  candidateName: string;
  organizationName: string;
  videoReady: boolean;
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

  if (left) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Thanks for your time</h1>
        <p className="text-sm text-muted-foreground">You&apos;ve left the interview. If this was a mistake, reopen your link to rejoin.</p>
        <Button onClick={() => window.location.reload()}>Rejoin</Button>
      </Centered>
    );
  }

  if (conn) {
    return (
      <LiveKitRoom
        serverUrl={conn.url}
        token={conn.token}
        connect
        audio={false}
        video={false}
        onDisconnected={() => setLeft(true)}
        className="h-screen"
        data-lk-theme="default"
      >
        <CandidateRoom choices={conn.choices} />
        <RoomAudioRenderer />
        <StartAudio label="Click to enable audio" />
      </LiveKitRoom>
    );
  }

  if (!info) {
    return <Centered>{error ? <p className="text-sm text-muted-foreground">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}</Centered>;
  }

  const when = info.scheduledAt ? new Date(info.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const closed = info.status !== "scheduled" && info.status !== "live";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6" data-lk-theme="default">
      <div className="max-w-lg text-center">
        <h1 className="text-xl font-bold">Hi {info.candidateName}</h1>
        <p className="text-sm text-muted-foreground">
          {info.organizationName ? `${info.organizationName} · ` : ""}
          {info.title}
          {when ? ` · ${when}` : ""}
        </p>
      </div>
      {closed ? (
        <p className="text-sm text-muted-foreground">{info.status === "ended" ? "This interview has ended." : "This interview is not open."}</p>
      ) : !info.videoReady ? (
        <p className="text-sm text-muted-foreground">Video isn&apos;t available right now. Please try again in a few minutes.</p>
      ) : (
        <>
          <p className="max-w-lg text-center text-sm text-muted-foreground">
            Check your camera and microphone below. Use a quiet place and a laptop if you can.
          </p>
          <label className="flex max-w-lg items-start gap-2 rounded-lg border p-3 text-sm">
            <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>
              I understand this interview is conducted live by the hiring team and that the conversation is transcribed with
              AI assistance to help the panel take notes and write their evaluation.
            </span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className={consent ? "w-full max-w-lg" : "pointer-events-none w-full max-w-lg opacity-50"}>
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

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">{children}</div>;
}

/** Lobby until the host admits (publish permission arrives), then the call. */
function CandidateRoom({ choices }: { choices: LocalUserChoices }) {
  const room = useRoomContext();
  const perms = useLocalParticipantPermissions();
  const { localParticipant } = useLocalParticipant();
  const admitted = perms?.canPublish === true;
  const published = useRef(false);

  useEffect(() => {
    if (!admitted || published.current) return;
    published.current = true;
    void localParticipant.setMicrophoneEnabled(choices.audioEnabled, choices.audioEnabled ? { deviceId: choices.audioDeviceId } : undefined);
    void localParticipant.setCameraEnabled(choices.videoEnabled, choices.videoEnabled ? { deviceId: choices.videoDeviceId } : undefined);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
      <VideoStage className="min-h-[240px] flex-1" />
      <div className="shrink-0">
        <RoomControls onLeave={() => void room.disconnect()} />
      </div>
    </div>
  );
}
