"use client";

import type { AntiCheatingViolation } from "@/hooks/use-anti-cheating";
import { useAntiCheating } from "@/hooks/use-anti-cheating";
import { useIntegrityMonitor, type IntegrityWarnKind } from "@/hooks/use-integrity-monitor";
import { markInterviewEnded, markModalOpen } from "@/lib/anti-cheating-state";
import { captureStrikeEvidence } from "@/lib/capture-camera-snapshot";
import { MAX_STRIKES, STRIKE_LABEL, aiStrikeNotice } from "@/lib/head-movement";
import { publishAiNotice, publishStrike } from "@/lib/integrity/bus";
import type { IntegritySignal } from "@/lib/integrity/signals";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Ban, Camera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface AntiCheatingGuardProps {
  enabled: boolean;
  sessionId?: string;
  /** Device guard, lip-sync, answer timing, reading pattern, extension detection. */
  integrityChecksEnabled?: boolean;
  livenessChallengesEnabled?: boolean;
  /** Called after the candidate acknowledges the final (4th) violation. */
  onDisqualified?: () => void;
}

type GuardViolation = Omit<AntiCheatingViolation, "type"> & {
  type: AntiCheatingViolation["type"] | IntegrityWarnKind;
};

type ModalState =
  | { phase: "checking"; reason: string }
  | { phase: "warning"; count: number; reason: string }
  | { phase: "final"; reason: string };

const SIGNAL_FLUSH_MS = 10_000;

/**
 * Page departure / paste / multi-screen violations. Shares one strict
 * strike count (server-side) with head-movement detection: strikes 1–3 are
 * warnings (the AI says the 3rd aloud), the 4th ends and disqualifies the session.
 */
export function AntiCheatingGuard({
  enabled,
  sessionId,
  integrityChecksEnabled = false,
  livenessChallengesEnabled = false,
  onDisqualified,
}: AntiCheatingGuardProps) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const openRef = useRef(false);
  const done = useRef(false);
  const localCount = useRef(0);
  const okBtnRef = useRef<HTMLButtonElement | null>(null);
  const report = trpc.session.reportAntiCheatingViolation.useMutation();
  const reportRef = useRef(report);
  reportRef.current = report;
  const onDqRef = useRef(onDisqualified);
  onDqRef.current = onDisqualified;

  const handleViolation = useCallback(
    (violation: GuardViolation) => {
      if (!sessionId || done.current || openRef.current) return;
      openRef.current = true;
      const reason = STRIKE_LABEL[violation.type] ?? "Anti-cheating violation";
      setModal({ phase: "checking", reason });
      void (async () => {
        localCount.current += 1;
        let count = localCount.current;
        let disqualified = count >= MAX_STRIKES;
        let evidencePayload: Awaited<ReturnType<typeof captureStrikeEvidence>> = {
          detail: violation.detail || reason,
        };
        try {
          evidencePayload = await captureStrikeEvidence({
            sessionId,
            type: violation.type,
            detail: violation.detail || reason,
            timestamp: violation.timestamp,
            strikeNumber: count,
            prefix: `strike-${violation.type}`,
          });
        } catch (err) {
          console.warn("[anti-cheating] snapshot failed", err);
        }
        try {
          const res = await reportRef.current.mutateAsync({
            sessionId,
            violation: {
              type: violation.type,
              timestamp: violation.timestamp,
              ...evidencePayload,
            },
          });
          const strikes = (res as { strikes?: number }).strikes ?? res.headViolations;
          if (typeof strikes === "number") {
            count = strikes;
            localCount.current = strikes;
          }
          disqualified = !!res.disqualified;
        } catch (err) {
          console.warn("[anti-cheating] report failed", err);
        }
        publishStrike({ count, max: MAX_STRIKES, disqualified, lastReason: reason });
        const notice = disqualified ? null : aiStrikeNotice(count, reason);
        if (notice) publishAiNotice(notice);

        if (disqualified) {
          done.current = true;
          markInterviewEnded();
          setModal({ phase: "final", reason });
        } else {
          setModal({ phase: "warning", count, reason });
        }
      })();
    },
    [sessionId],
  );

  useAntiCheating({ enabled, onViolation: handleViolation });

  // ── Integrity checks ────────────────────────────────────────────
  const [deviceNotice, setDeviceNotice] = useState<{ label: string; kind: "audio" | "video" } | null>(null);
  const recordSignals = trpc.session.recordIntegritySignals.useMutation();
  const recordRef = useRef(recordSignals);
  recordRef.current = recordSignals;
  const pending = useRef<IntegritySignal[]>([]);
  const integrityOn = enabled && integrityChecksEnabled && !!sessionId;

  const flushSignals = useCallback(() => {
    if (!sessionId || pending.current.length === 0) return;
    const batch = pending.current.splice(0, 50);
    recordRef.current.mutateAsync({ sessionId, signals: batch }).catch((err) => {
      console.warn("[integrity] signal upload failed", err);
      pending.current = [...batch, ...pending.current].slice(0, 200);
    });
  }, [sessionId]);

  useEffect(() => {
    if (!integrityOn) return;
    const timer = setInterval(flushSignals, SIGNAL_FLUSH_MS);
    window.addEventListener("pagehide", flushSignals);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", flushSignals);
      flushSignals();
    };
  }, [integrityOn, flushSignals]);

  const { livenessPrompt } = useIntegrityMonitor({
    enabled: integrityOn,
    livenessEnabled: livenessChallengesEnabled,
    onWarn: (type, detail) => handleViolation({ type, timestamp: Date.now(), detail }),
    onVirtualDevice: (label, kind) => setDeviceNotice((cur) => cur ?? { label, kind }),
    onSignal: (s) => {
      if (done.current) return;
      pending.current.push(s);
      if (pending.current.length >= 50) flushSignals();
    },
  });

  useEffect(() => {
    if (!deviceNotice) return;
    markModalOpen(true);
    return () => markModalOpen(false);
  }, [deviceNotice]);

  useEffect(() => {
    if (!modal) return;
    markModalOpen(true);
    okBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.target === okBtnRef.current && (e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      e.stopPropagation();
      okBtnRef.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      markModalOpen(false);
    };
  }, [modal]);

  const acknowledge = useCallback(() => {
    if (!modal || modal.phase === "checking") return;
    if (modal.phase === "final") {
      setModal(null);
      onDqRef.current?.();
      return;
    }
    openRef.current = false;
    setModal(null);
  }, [modal]);

  if (!enabled) return null;
  if (!modal) {
    return (
      <>
        {livenessPrompt && (
          <div
            role="status"
            aria-live="assertive"
            className="pointer-events-none fixed left-1/2 top-4 z-[9995] -translate-x-1/2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg"
          >
            {livenessPrompt}
          </div>
        )}
        {deviceNotice && (
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="vd-title"
          >
            <div className="mx-4 w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 text-center shadow-2xl sm:p-6 dark:border-amber-900 dark:bg-gray-900">
              <Camera className="mx-auto h-10 w-10 text-amber-600" />
              <h2 id="vd-title" className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">
                Please use your physical {deviceNotice.kind === "video" ? "camera" : "microphone"}
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                This interview is using a virtual {deviceNotice.kind === "video" ? "camera" : "audio device"} (&quot;{deviceNotice.label}&quot;).
                Switch to your built-in or USB {deviceNotice.kind === "video" ? "webcam" : "microphone"} in your browser or system settings.
                This is not a violation; it has been noted for the interviewer.
              </p>
              <button
                type="button"
                onClick={() => setDeviceNotice(null)}
                className="mt-5 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
              >
                OK
              </button>
            </div>
          </div>
        )}
      </>
    );
  }
  const warnings = MAX_STRIKES - 1;
  const isFinal = modal.phase === "final";

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ac-title"
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
        <h2 id="ac-title" className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">
          {isFinal ? "Interview ended — disqualified" : "Anti-cheating violation"}
        </h2>
        {modal.phase === "warning" && (
          <p className="mt-2 inline-block rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
            Warning {Math.min(modal.count, warnings)} of {warnings}
          </p>
        )}
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {isFinal
            ? `You were disqualified after ${MAX_STRIKES} anti-cheating violations (last: ${modal.reason.toLowerCase()}). Your interview has ended and cannot be resumed.`
            : `Detected: ${modal.reason.toLowerCase()}. This has been recorded.`}
        </p>
        {!isFinal && (
          <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
            Stay on this page and keep facing the screen. Violation {MAX_STRIKES} will disqualify you and end the interview.
          </p>
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
  );
}
