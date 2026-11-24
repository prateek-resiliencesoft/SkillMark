"use client";

import { ParticipantTile, useTracks, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { CANDIDATE_IDENTITY_PREFIX } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";

function key(t: TrackReferenceOrPlaceholder) {
  return `${t.participant.identity}:${t.source}`;
}

/**
 * Video stage: one large focus tile (any screen share, else the candidate, else the
 * first remote) plus a strip of everyone else.
 */
export function VideoStage({ className }: { className?: string }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const visible = tracks.filter((t) => !t.participant.identity.startsWith("agent:"));
  const screen = visible.find((t) => t.source === Track.Source.ScreenShare);
  const candidateCam = visible.find(
    (t) => t.source === Track.Source.Camera && t.participant.identity.startsWith(CANDIDATE_IDENTITY_PREFIX),
  );
  const firstRemote = visible.find((t) => t.source === Track.Source.Camera && !t.participant.isLocal);
  const focus = screen ?? candidateCam ?? firstRemote ?? visible[0];
  const others = visible.filter((t) => !focus || key(t) !== key(focus));

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
        {focus ? (
          <ParticipantTile trackRef={focus} className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">Waiting for others to join…</div>
        )}
      </div>
      {others.length > 0 && (
        <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
          {others.map((t) => (
            <div key={key(t)} className="aspect-video h-full shrink-0 overflow-hidden rounded-lg bg-black">
              <ParticipantTile trackRef={t} className="h-full w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
