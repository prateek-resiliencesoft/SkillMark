"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOrg } from "@/components/org-provider";
import {
  TOUR_STEPS,
  TOUR_EDIT_URL_KEY,
  getStoredTourState,
  setStoredTourState,
  type TourStep,
} from "./tour-steps";

/** Skip create-org when user already has an organization. */
function initialStepIndex(orgCount: number) {
  if (orgCount > 0) {
    const idx = TOUR_STEPS.findIndex((s) => s.id === "new-interview");
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

interface TourContextValue {
  active: boolean;
  completed: boolean;
  currentStep: TourStep | null;
  stepIndex: number;
  totalSteps: number;
  steps: TourStep[];
  /** Incremented to force overlay re-measurement (e.g. when recovering tooltip) */
  showKey: number;
  /** True briefly after skip() to show recovery hint near the icon */
  showRecoveryHint: boolean;
  /** True when the welcome screen should be displayed (first-time users) */
  showWelcome: boolean;
  next: () => void;
  prev: () => void;
  skip: () => void;
  /** Permanently dismiss the tour (hides red dot) */
  dismiss: () => void;
  start: () => void;
  /** Jump to a specific step index and activate the tour */
  goToStep: (idx: number) => void;
  /** Call when the user performs the action for the current step */
  completeStep: (stepId: string) => void;
  clearRecoveryHint: () => void;
  /** Reset tour progress and show the welcome screen again */
  restart: () => void;
  /** Start the tour from the welcome screen */
  acceptWelcome: () => void;
  /** Hide the welcome screen for this session only */
  dismissWelcome: () => void;
  /** True when the celebration modal should be displayed after tour completion */
  showCelebration: boolean;
  /** Dismiss the celebration modal */
  dismissCelebration: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
}

export function useTourSafe() {
  return useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { orgs, isLoading: orgsLoading } = useOrg();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [showKey, setShowKey] = useState(0);
  const [showRecoveryHint, setShowRecoveryHint] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    const stored = getStoredTourState();
    if (stored) {
      if (stored.completed) {
        setCompleted(true);
      } else if (!stored.dismissed) {
        setStepIndex(stored.currentStep);
        setActive(true);
      }
    } else {
      setShowWelcome(true);
    }
    setReady(true);
  }, []);

  const persist = useCallback(
    (idx: number, completed = false, dismissed = false) => {
      setStoredTourState({
        currentStep: idx,
        completed,
        dismissed,
      });
    },
    [],
  );

  // If tour resumed on create-org but user already has an org, skip ahead.
  useEffect(() => {
    if (!ready || orgsLoading || !active) return;
    const step = TOUR_STEPS[stepIndex];
    if (step?.id === "create-org" && orgs.length > 0) {
      const idx = initialStepIndex(orgs.length);
      setStepIndex(idx);
      persist(idx);
      const next = TOUR_STEPS[idx];
      if (next && !pathname.includes(next.page) && !next.page.startsWith("/edit/")) {
        router.push(next.page);
      }
    }
  }, [ready, orgsLoading, active, stepIndex, orgs.length, persist, pathname, router]);

  useEffect(() => {
    if (active && pathname.includes("/edit/")) {
      try {
        localStorage.setItem(TOUR_EDIT_URL_KEY, pathname);
      } catch {}
    }
  }, [active, pathname]);

  const currentStep = active ? TOUR_STEPS[stepIndex] ?? null : null;

  const isStepOnCurrentPage = useCallback(
    (step: TourStep | null) => {
      if (!step) return false;
      return pathname.includes(step.page);
    },
    [pathname],
  );

  const next = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= TOUR_STEPS.length) {
      setActive(false);
      setCompleted(true);
      setShowCelebration(true);
      persist(nextIdx, true);
      return;
    }
    setStepIndex(nextIdx);
    persist(nextIdx);
  }, [stepIndex, persist]);

  const prev = useCallback(() => {
    const prevIdx = Math.max(0, stepIndex - 1);
    setStepIndex(prevIdx);
    persist(prevIdx);
  }, [stepIndex, persist]);

  const skip = useCallback(() => {
    setActive(false);
    setShowRecoveryHint(true);
    persist(stepIndex, false, true);
  }, [stepIndex, persist]);

  const clearRecoveryHint = useCallback(() => {
    setShowRecoveryHint(false);
  }, []);

  const dismiss = useCallback(() => {
    setActive(false);
    setCompleted(true);
    persist(stepIndex, true, true);
  }, [stepIndex, persist]);

  const start = useCallback(() => {
    if (active) {
      const step = TOUR_STEPS[stepIndex];
      if (step && pathname.includes(step.page)) {
        setShowKey((k) => k + 1);
        return;
      }
      for (let i = stepIndex - 1; i >= 0; i--) {
        if (pathname.includes(TOUR_STEPS[i].page)) {
          setStepIndex(i);
          setShowKey((k) => k + 1);
          persist(i);
          return;
        }
      }
    }
    const idx = initialStepIndex(orgs.length);
    const step = TOUR_STEPS[idx];
    setStepIndex(idx);
    setActive(true);
    setCompleted(false);
    setShowKey((k) => k + 1);
    persist(idx);
    if (step && !pathname.includes(step.page) && !step.page.startsWith("/edit/")) {
      router.push(step.page);
    }
  }, [active, stepIndex, pathname, persist, orgs.length, router]);

  const goToStep = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, TOUR_STEPS.length - 1));
      setStepIndex(clamped);
      setActive(true);
      setCompleted(false);
      setShowKey((k) => k + 1);
      persist(clamped);
    },
    [persist],
  );

  const completeStep = useCallback(
    (stepId: string) => {
      if (!active) return;
      const step = TOUR_STEPS[stepIndex];
      if (step && step.id === stepId) {
        next();
      }
    },
    [active, stepIndex, next],
  );

  const restart = useCallback(() => {
    const idx = initialStepIndex(orgs.length);
    setActive(false);
    setStepIndex(idx);
    setCompleted(false);
    setShowWelcome(true);
    persist(idx, false, false);
  }, [persist, orgs.length]);

  const acceptWelcome = useCallback(() => {
    if (orgsLoading) return;
    const idx = initialStepIndex(orgs.length);
    const step = TOUR_STEPS[idx];
    setShowWelcome(false);
    setStepIndex(idx);
    setActive(true);
    setCompleted(false);
    setShowKey((k) => k + 1);
    persist(idx);
    if (step && !pathname.includes(step.page) && !step.page.startsWith("/edit/")) {
      router.push(step.page);
    }
  }, [persist, orgs.length, orgsLoading, pathname, router]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const dismissCelebration = useCallback(() => {
    setShowCelebration(false);
  }, []);

  const value = useMemo(
    () => ({
      active: active && ready,
      completed,
      currentStep: isStepOnCurrentPage(currentStep) ? currentStep : null,
      stepIndex,
      totalSteps: TOUR_STEPS.length,
      steps: TOUR_STEPS,
      showKey,
      showRecoveryHint,
      showWelcome: showWelcome && ready,
      next,
      prev,
      skip,
      dismiss,
      start,
      goToStep,
      completeStep,
      clearRecoveryHint,
      restart,
      acceptWelcome,
      dismissWelcome,
      showCelebration,
      dismissCelebration,
    }),
    [
      active,
      ready,
      completed,
      currentStep,
      isStepOnCurrentPage,
      stepIndex,
      showKey,
      showRecoveryHint,
      showWelcome,
      showCelebration,
      next,
      prev,
      skip,
      dismiss,
      start,
      goToStep,
      completeStep,
      clearRecoveryHint,
      restart,
      acceptWelcome,
      dismissWelcome,
      dismissCelebration,
    ],
  );

  return (
    <TourContext.Provider value={value}>{children}</TourContext.Provider>
  );
}
