"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PreflightProvider, usePreflightReport } from "@/hooks/use-preflight-tracker";
import {
  getStoredScreenStream,
  setStoredScreenStream,
  subscribeScreenStream,
} from "@/lib/media-stream-store";
import { requestInterviewScreenShare } from "@/lib/screen-share-request";
import {
  SCREEN_SHARE_STOPPED_BODY,
  SCREEN_SHARE_STOPPED_TITLE,
  SCREEN_SHARE_UNSUPPORTED_BODY,
  SCREEN_SHARE_UNSUPPORTED_TITLE,
  canUseDisplayMedia,
  screenShareErrorHelp,
} from "@/lib/screen-share";
import { AlertCircle, Check, Copy, Monitor, RefreshCw, ScreenShare } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

function interviewUrl(): string {
  return typeof window !== "undefined" ? window.location.href : "";
}

function useLiveScreenShare() {
  const [active, setActive] = useState(() => !!getStoredScreenStream());
  useEffect(() => {
    const sync = () => setActive(!!getStoredScreenStream());
    sync();
    return subscribeScreenStream(sync);
  }, []);
  return active;
}

/** Prompt used in the device check and when a share is missing or stopped. */
export function ScreenSharePrompt({
  title,
  onShared,
  reportSource = "screen",
}: {
  title?: string;
  onShared?: () => void;
  reportSource?: string;
}) {
  const report = usePreflightReport();
  const [errorKind, setErrorKind] = useState<"denied" | "not_entire" | "unsupported" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const supported =
    typeof navigator !== "undefined" && canUseDisplayMedia(navigator.mediaDevices);
  const url = interviewUrl();

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* ignore */
    }
  }, [url]);

  const requestShare = useCallback(async () => {
    setBusy(true);
    setErrorKind(null);
    const result = await requestInterviewScreenShare();
    setBusy(false);
    if (!result.ok) {
      setErrorKind(result.kind);
      if (result.kind === "denied" || result.kind === "failed") {
        report("screen_share", "denied");
        report("error", "error", { code: result.kind, source: reportSource });
      }
      return;
    }
    const stream = result.stream;
    setStoredScreenStream(stream);
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      report("screen_share", "stopped");
      if (getStoredScreenStream() === stream) setStoredScreenStream(null);
    });
    report("screen_share", "started");
    onShared?.();
  }, [onShared, report, reportSource]);

  if (!supported) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <Monitor className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{SCREEN_SHARE_UNSUPPORTED_TITLE}</p>
              <p className="text-xs text-muted-foreground">{SCREEN_SHARE_UNSUPPORTED_BODY}</p>
              {url && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-muted-foreground">Open this link on a computer:</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-[11px]">{url}</code>
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>
                      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <ScreenShare className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium">{title ?? "Screen sharing is required"}</p>
          <p className="text-xs text-muted-foreground">
            After clicking &quot;Share Screen&quot;, select{" "}
            <span className="font-medium text-foreground">&quot;Entire Screen&quot;</span> and click
            &quot;Share&quot;. You cannot continue without it.
          </p>
          {errorKind && (
            <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{screenShareErrorHelp(errorKind)}</span>
            </div>
          )}
          <Button type="button" size="sm" onClick={() => void requestShare()} disabled={busy}>
            {busy ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Monitor className="mr-1.5 h-3.5 w-3.5" />}
            {errorKind ? "Retry" : "Share Screen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Keeps the interview behind a live screen share. A refresh or a direct URL
 * cannot skip the check. If the share ends mid-interview, the session stays
 * mounted and a re-share prompt covers it.
 */
function ScreenShareGateBody({
  optional = false,
  children,
}: {
  optional?: boolean;
  children: ReactNode;
}) {
  const active = useLiveScreenShare();
  const blocked = !optional && !active;

  return (
    <>
      {children}
      {blocked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg">
            <ScreenSharePrompt title={SCREEN_SHARE_STOPPED_TITLE} />
            <p className="mt-3 text-center text-xs text-muted-foreground">{SCREEN_SHARE_STOPPED_BODY}</p>
          </div>
        </div>
      )}
    </>
  );
}

export function ScreenShareGate({
  optional = false,
  sessionId,
  inviteToken,
  children,
}: {
  optional?: boolean;
  sessionId?: string;
  inviteToken?: string;
  children: ReactNode;
}) {
  const body = (
    <ScreenShareGateBody optional={optional}>{children}</ScreenShareGateBody>
  );
  if (optional || (!sessionId && !inviteToken)) return body;
  return (
    <PreflightProvider token={inviteToken} sessionId={sessionId}>
      {body}
    </PreflightProvider>
  );
}

