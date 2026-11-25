"use client";

import { ParticipantTile, useTracks, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { LK_THEME } from "@/components/round-two/room/lk-theme";
import { CANDIDATE_IDENTITY_PREFIX } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";

function key(t: TrackReferenceOrPlaceholder) {
  return `${t.participant.identity}:${t.source}`;
}

/**
 * Video stage: one large focus tile (any screen share, else the candidate, else the
 * first remote) plus an overlay strip of everyone else.
 * Filmstrip is absolute so joining / mute / sidebar clicks never resize the main tile.
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
    <div className={cn("relative min-h-0 flex-1 overflow-hidden", className)}>
      <div className="absolute inset-0 overflow-hidden rounded-xl bg-black">
        {focus ? (
          <ParticipantTile trackRef={focus} className="h-full w-full [&_video]:object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">Waiting for others to join…</div>
        )}
      </div>
      {others.length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex h-24 gap-2 overflow-x-auto">
          {others.map((t) => (
            <div
              key={key(t)}
              className="pointer-events-auto aspect-video h-full shrink-0 overflow-hidden rounded-lg bg-black/90 ring-1 ring-white/20"
            >
              <ParticipantTile trackRef={t} className="h-full w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
