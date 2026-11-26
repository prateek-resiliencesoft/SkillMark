"use client";

import { TrackToggle, useLocalParticipant, useLocalParticipantPermissions } from "@livekit/components-react";
import { Track, type ScreenShareCaptureOptions } from "livekit-client";
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
import { MonitorUp, MonitorX, PhoneOff } from "lucide-react";
import { useState } from "react";
import { LK_THEME } from "./lk-theme";

const SHARE_OPTIONS: ScreenShareCaptureOptions = {
  audio: false,
  video: { displaySurface: "window" },
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
};

/** Start a window share; `guard` warns panelists who picked the whole screen (it would show the copilot). */
export function useStartScreenShare(guard?: boolean) {
  const { localParticipant } = useLocalParticipant();
  const { toast } = useToast();
  return async () => {
    try {
      const pub = await localParticipant.setScreenShareEnabled(true, SHARE_OPTIONS);
      const surface = pub?.track?.mediaStreamTrack.getSettings() as MediaTrackSettings & { displaySurface?: string };
      if (guard && surface?.displaySurface === "monitor") {
        toast({
          title: "You're sharing your entire screen",
          description: "The candidate can see everything, including the copilot panel. Share a single window or tab instead.",
          variant: "destructive",
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        toast({ title: "Couldn't share screen", description: err.message, variant: "destructive" });
      }
    }
  };
}

/**
 * Mic / camera / screen share / leave. `guardScreenShare` warns panelists before sharing,
 * since sharing the whole screen would show the private copilot panel. Observers get no
 * share button (their token can't publish a screen share either).
 */
export function RoomControls({
  onLeave,
  leaveLabel = "Leave",
  guardScreenShare,
  canScreenShare = true,
}: {
  onLeave: () => void;
  leaveLabel?: string;
  guardScreenShare?: boolean;
  canScreenShare?: boolean;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const perms = useLocalParticipantPermissions();
  const [confirmShare, setConfirmShare] = useState(false);
  const canPublish = perms?.canPublish !== false;
  const startShare = useStartScreenShare(guardScreenShare);

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 bg-transparent" {...LK_THEME}>
      {canPublish && (
        <>
          <TrackToggle source={Track.Source.Microphone} showIcon className="lk-button" />
          <TrackToggle source={Track.Source.Camera} showIcon className="lk-button" />
          {canScreenShare && (
            <Button
              variant={isScreenShareEnabled ? "default" : "secondary"}
              size="sm"
              className="h-10"
              onClick={() => {
                if (isScreenShareEnabled) void localParticipant.setScreenShareEnabled(false);
                else if (guardScreenShare) setConfirmShare(true);
                else void startShare();
              }}
            >
              {isScreenShareEnabled ? <MonitorX className="mr-1.5 h-4 w-4" /> : <MonitorUp className="mr-1.5 h-4 w-4" />}
              {isScreenShareEnabled ? "Stop sharing" : "Share screen"}
            </Button>
          )}
        </>
      )}
      <Button variant="destructive" size="sm" className="h-10" onClick={onLeave}>
        <PhoneOff className="mr-1.5 h-4 w-4" />
        {leaveLabel}
      </Button>

      <AlertDialog open={confirmShare} onOpenChange={setConfirmShare}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share a window, not your whole screen</AlertDialogTitle>
            <AlertDialogDescription>
              The AI copilot panel is private to the interview panel. If you share your entire screen, the candidate will see
              it. Pick a single window or a different browser tab in the next dialog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmShare(false);
                void startShare();
              }}
            >
              Choose what to share
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
