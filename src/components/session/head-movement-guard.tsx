"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useHeadMovementDetection } from "@/hooks/use-head-movement-detection";
import {
  HEAD_STATE_LABEL,
  MAX_STRIKES,
  type HeadFrameState,
} from "@/lib/head-movement";
import { detectionsSuppressed, markInterviewEnded, markModalOpen } from "@/lib/anti-cheating-state";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Ban } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  enabled: boolean;
  sessionId?: string;
  onDisqualified: () => void;
}

type ModalState =
  | { phase: "checking"; reason: string }
  | { phase: "warning"; count: number; reason: string }
  | { phase: "final"; reason: string };

const GRACE_MS = 3000;

export function HeadMovementGuard({ enabled, sessionId, onDisqualified }: Props) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const localCount = useRef(0);
  const busy = useRef<Promise<void>>(Promise.resolve());
  const done = useRef(false);
  const openRef = useRef(false);
  const report = trpc.session.reportAntiCheatingViolation.useMutation();
  const reportRef = useRef(report);
  reportRef.current = report;
  const onDqRef = useRef(onDisqualified);
  onDqRef.current = onDisqualified;
  const captureRef = useRef<() => Promise<Blob | null>>(async () => null);
  const okBtnRef = useRef<HTMLButtonElement | null>(null);

  const handle = useCallback(
    (kind: Exclude<HeadFrameState, "ok">) => {
      // One modal at a time: ignore anything detected while a warning is pending/open.
      if (done.current || !sessionId || openRef.current || detectionsSuppressed()) return;
      openRef.current = true;
      setModal({ phase: "checking", reason: HEAD_STATE_LABEL[kind] });
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
        let disqualified = count >= MAX_STRIKES;
        try {
          const res = await reportRef.current.mutateAsync({
            sessionId,
            violation: { type: "head_movement", timestamp, detail: HEAD_STATE_LABEL[kind], imageUrl, imagePath },
          });
          const strikes = (res as { strikes?: number }).strikes ?? res.headViolations;
          if (typeof strikes === "number") {
            count = strikes;
            localCount.current = count;
          }
          disqualified = !!res.disqualified;
        } catch (err) {
          console.warn("[head-movement] report failed", err);
        }

        if (disqualified) {
          done.current = true;
          setModal({ phase: "final", reason: HEAD_STATE_LABEL[kind] });
        } else {
          setModal({ phase: "warning", count, reason: HEAD_STATE_LABEL[kind] });
        }
      });
    },
    [sessionId],
  );

  const { status, captureSnapshot } = useHeadMovementDetection({
    enabled: enabled && !!sessionId,
    onViolation: handle,
    paused: modal !== null || done.current,
    graceMs: GRACE_MS,
  });
  captureRef.current = captureSnapshot;

  useEffect(() => {
    if (!modal) return;
    markModalOpen(true);
    return () => markModalOpen(false);
  }, [modal]);
  useEffect(() => {
    if (modal?.phase === "final") markInterviewEnded();
  }, [modal]);

  // Modal is not dismissable by Esc / keyboard shortcuts of the interview UI.
  useEffect(() => {
    if (!modal) return;
    okBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.target === okBtnRef.current && (e.key === "Enter" || e.key === " ")) return;
      if (e.key === "Tab") { e.preventDefault(); okBtnRef.current?.focus(); return; }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [modal]);

  const acknowledge = useCallback(() => {
    if (!modal || modal.phase === "checking") return;
    if (modal.phase === "final") {
      setModal(null);
      onDqRef.current();
      return;
    }
    openRef.current = false;
    setModal(null); // detection resumes after GRACE_MS
  }, [modal]);

  if (!enabled) return null;

  const warnings = MAX_STRIKES - 1;
  const isFinal = modal?.phase === "final";

  return (
    <>
      {status === "active" && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-[9990] rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
          Head tracking active
        </div>
      )}
      {modal && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="hm-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-red-200 bg-white p-5 text-center shadow-2xl sm:p-6 dark:border-red-900 dark:bg-gray-900">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
              {isFinal ? (
                <Ban className="h-8 w-8 text-red-600 dark:text-red-400" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
              )}
            </div>
            <h2 id="hm-title" className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">
              {isFinal ? "Interview ended — disqualified" : "You looked away from the screen"}
            </h2>
            {modal.phase === "warning" && (
              <p className="mt-2 inline-block rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                Warning {Math.min(modal.count, warnings)} of {warnings}
              </p>
            )}
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
              {isFinal
                ? `You were disqualified after ${MAX_STRIKES} anti-cheating violations (last: ${modal.reason.toLowerCase()}). Your interview has ended and cannot be resumed.`
                : `Detected: ${modal.reason.toLowerCase()}. A snapshot was recorded.`}
            </p>
            {!isFinal && (
              <ul className="mt-3 space-y-1 text-left text-sm text-gray-600 dark:text-gray-300">
                <li>• Keep your face centered and visible to the camera.</li>
                <li>• Look at the screen while answering; don&apos;t turn away or look down for long.</li>
                <li>• Make sure no one else is in view and your room is well lit.</li>
                <li className="font-medium text-red-600 dark:text-red-400">
                  • Violation {MAX_STRIKES} will disqualify you and end the interview.
                </li>
              </ul>
            )}
            <button
              ref={okBtnRef}
              type="button"
              onClick={acknowledge}
              disabled={modal.phase === "checking"}
              className="mt-6 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {modal.phase === "checking" ? "Recording violation…" : "OK"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function DisqualifiedScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-12 text-center">
          <Ban className="mx-auto h-16 w-16 text-red-600" />
          <h2 className="mt-4 text-2xl font-bold">Interview ended — disqualified</h2>
          <p className="mt-2 text-muted-foreground">
            Interview ended — disqualified after repeated anti-cheating violations
            (leaving the page, looking away, or similar). This session cannot be resumed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
