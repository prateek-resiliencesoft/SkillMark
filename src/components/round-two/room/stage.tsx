"use client";

import { ParticipantTile, useTracks, type TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Pin, PinOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CANDIDATE_IDENTITY_PREFIX } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";

function key(t: TrackReferenceOrPlaceholder) {
  return `${t.participant.identity}:${t.source}`;
}

/**
 * Video stage: one large focus tile + overlay filmstrip.
 * Click any tile to pin it to the main stage (Meet-style); click again / unpin to restore auto focus.
 * Filmstrip is absolute so joining / mute never resizes the main tile.
 */
export function VideoStage({ className }: { className?: string }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const visible = useMemo(
    () => tracks.filter((t) => !t.participant.identity.startsWith("agent:")),
    [tracks],
  );
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

  useEffect(() => {
    if (pinnedKey && !visible.some((t) => key(t) === pinnedKey)) setPinnedKey(null);
  }, [visible, pinnedKey]);

  const screen = visible.find((t) => t.source === Track.Source.ScreenShare);
  const candidateCam = visible.find(
    (t) => t.source === Track.Source.Camera && t.participant.identity.startsWith(CANDIDATE_IDENTITY_PREFIX),
  );
  const firstRemote = visible.find((t) => t.source === Track.Source.Camera && !t.participant.isLocal);
  const autoFocus = screen ?? candidateCam ?? firstRemote ?? visible[0];
  const pinned = pinnedKey ? visible.find((t) => key(t) === pinnedKey) : undefined;
  const focus = pinned ?? autoFocus;
  const others = visible.filter((t) => !focus || key(t) !== key(focus));
  const isPinned = !!pinned;

  const pin = (t: TrackReferenceOrPlaceholder) => {
    const k = key(t);
    setPinnedKey((prev) => (prev === k ? null : k));
  };

  return (
    <div className={cn("relative min-h-0 flex-1 overflow-hidden", className)}>
      <div className="absolute inset-0 overflow-hidden rounded-xl bg-black">
        {focus ? (
          <button
            type="button"
            className="group relative h-full w-full cursor-pointer border-0 bg-transparent p-0 text-left"
            onClick={() => {
              if (isPinned) setPinnedKey(null);
              else pin(focus);
            }}
            title={isPinned ? "Unpin" : "Pin this video"}
          >
            <ParticipantTile trackRef={focus} className="pointer-events-none h-full w-full [&_video]:object-contain" />
            <span
              className={cn(
                "absolute left-3 top-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-white shadow",
                isPinned ? "bg-primary/90" : "bg-black/50 opacity-0 transition-opacity group-hover:opacity-100",
              )}
            >
              {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              {isPinned ? "Pinned · click to unpin" : "Click to pin"}
            </span>
          </button>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">Waiting for others to join…</div>
        )}
      </div>
      {others.length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex h-24 gap-2 overflow-x-auto">
          {others.map((t) => {
            const k = key(t);
            const active = pinnedKey === k;
            return (
              <button
                key={k}
                type="button"
                title={`Pin ${t.participant.name || t.participant.identity}`}
                onClick={() => pin(t)}
                className={cn(
                  "pointer-events-auto relative aspect-video h-full shrink-0 overflow-hidden rounded-lg bg-black/90 transition ring-offset-1 ring-offset-black",
                  active ? "ring-2 ring-primary" : "ring-1 ring-white/20 hover:ring-2 hover:ring-white/60",
                )}
              >
                <ParticipantTile trackRef={t} className="pointer-events-none h-full w-full" />
                <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                  <Pin className="h-2.5 w-2.5" />
                  {t.participant.name || (t.source === Track.Source.ScreenShare ? "Screen" : "Pin")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
