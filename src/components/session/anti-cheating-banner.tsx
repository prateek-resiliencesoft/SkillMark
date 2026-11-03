"use client";

import type { AntiCheatingViolation } from "@/hooks/use-anti-cheating";
import { useAntiCheating } from "@/hooks/use-anti-cheating";
import { markInterviewEnded, markModalOpen } from "@/lib/anti-cheating-state";
import { MAX_STRIKES, STRIKE_LABEL } from "@/lib/head-movement";
import { trpc } from "@/lib/trpc/client";
import { AlertTriangle, Ban } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface AntiCheatingGuardProps {
  enabled: boolean;
  sessionId?: string;
  /** Called after the candidate acknowledges the final (3rd) violation. */
  onDisqualified?: () => void;
}

type ModalState =
  | { phase: "checking"; reason: string }
  | { phase: "warning"; count: number; reason: string }
  | { phase: "final"; reason: string };

/**
 * Page departure / paste / multi-screen violations. Shares one strict
 * 3-strike count (server-side) with head-movement detection: warnings 1 and 2
 * need OK, the 3rd ends and disqualifies the session.
 */
export function AntiCheatingGuard({ enabled, sessionId, onDisqualified }: AntiCheatingGuardProps) {
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
    (violation: AntiCheatingViolation) => {
      if (!sessionId || done.current || openRef.current) return;
      openRef.current = true;
      const reason = STRIKE_LABEL[violation.type] ?? "Anti-cheating violation";
      setModal({ phase: "checking", reason });
      void (async () => {
        localCount.current += 1;
        let count = localCount.current;
        let disqualified = count >= MAX_STRIKES;
        try {
          const res = await reportRef.current.mutateAsync({
            sessionId,
            violation: { type: violation.type, timestamp: violation.timestamp, detail: violation.detail },
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

  if (!enabled || !modal) return null;
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
