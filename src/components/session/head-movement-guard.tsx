"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useHeadMovementDetection } from "@/hooks/use-head-movement-detection";
import {
  HEAD_STATE_LABEL,
  MAX_HEAD_VIOLATIONS,
  headWarningMessage,
  type HeadFrameState,
} from "@/lib/head-movement";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Ban } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface Props {
  enabled: boolean;
  sessionId?: string;
  onDisqualified: () => void;
}

export function HeadMovementGuard({ enabled, sessionId, onDisqualified }: Props) {
  const [warning, setWarning] = useState<{ count: number; reason: string } | null>(null);
  const localCount = useRef(0);
  const busy = useRef<Promise<void>>(Promise.resolve());
  const done = useRef(false);
  const report = trpc.session.reportAntiCheatingViolation.useMutation();
  const reportRef = useRef(report);
  reportRef.current = report;
  const onDqRef = useRef(onDisqualified);
  onDqRef.current = onDisqualified;
  const captureRef = useRef<() => Promise<Blob | null>>(async () => null);

  const handle = useCallback(
    (kind: Exclude<HeadFrameState, "ok">) => {
      if (done.current || !sessionId) return;
      busy.current = busy.current.then(async () => {
        if (done.current) return;
        const timestamp = Date.now();
        localCount.current += 1;
        let imageUrl: string | undefined;
        let imagePath: string | undefined;
        try {
          const blob = await captureRef.current();
          if (blob) {
            const fd = new FormData();
            fd.append("file", blob, "snapshot.jpg");
            fd.append("sessionId", sessionId);
            fd.append("type", "screenshot");
            fd.append("filename", `head-movement-${timestamp}.jpg`);
            const r = await fetch("/api/session/upload", { method: "POST", body: fd });
            if (r.ok) {
              const j = await r.json();
              imageUrl = j.url;
              imagePath = j.path;
            }
          }
        } catch (err) {
          console.warn("[head-movement] snapshot upload failed", err);
        }

        let count = localCount.current;
        let disqualified = count >= MAX_HEAD_VIOLATIONS;
        try {
          const res = await reportRef.current.mutateAsync({
            sessionId,
            violation: { type: "head_movement", timestamp, detail: HEAD_STATE_LABEL[kind], imageUrl, imagePath },
          });
          if (typeof res.headViolations === "number") {
            count = res.headViolations;
            localCount.current = count;
          }
          disqualified = !!res.disqualified;
        } catch (err) {
          console.warn("[head-movement] report failed", err);
        }

        if (disqualified) {
          done.current = true;
          setWarning(null);
          onDqRef.current();
        } else {
          setWarning({ count, reason: HEAD_STATE_LABEL[kind] });
        }
      });
    },
    [sessionId],
  );

  const { status, captureSnapshot } = useHeadMovementDetection({ enabled: enabled && !!sessionId, onViolation: handle });
  captureRef.current = captureSnapshot;

  if (!enabled) return null;

  return (
    <>
      {status === "active" && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-[9990] rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
          Head tracking active
        </div>
      )}
      {warning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-2xl dark:border-red-900 dark:bg-gray-900">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
              <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">{headWarningMessage(warning.count)}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Detected: {warning.reason}. A snapshot was recorded. On the {MAX_HEAD_VIOLATIONS}rd violation you will be
              disqualified and the interview will end.
            </p>
            <button
              onClick={() => setWarning(null)}
              className="mt-5 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
            >
              I understand, continue interview
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function DisqualifiedScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-12 text-center">
          <Ban className="mx-auto h-16 w-16 text-red-600" />
          <h2 className="mt-4 text-2xl font-bold">Interview ended</h2>
          <p className="mt-2 text-muted-foreground">
            Interview ended: disqualified for repeated head-movement violations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
