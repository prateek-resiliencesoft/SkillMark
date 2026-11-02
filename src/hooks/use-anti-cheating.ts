"use client";

import { detectionsSuppressed } from "@/lib/anti-cheating-state";
import { useCallback, useEffect, useRef, useState } from "react";

const DEPARTURE_MIN_MS = 1000;

export interface AntiCheatingViolation {
  type: "page_departure" | "paste" | "multi_screen";
  timestamp: number;
  detail?: string;
}

interface UseAntiCheatingOptions {
  enabled: boolean;
  onViolation?: (violation: AntiCheatingViolation) => void;
}

interface UseAntiCheatingResult {
  violations: AntiCheatingViolation[];
  departureCount: number;
  multiScreenDetected: boolean;
}

export function useAntiCheating({
  enabled,
  onViolation,
}: UseAntiCheatingOptions): UseAntiCheatingResult {
  const [violations, setViolations] = useState<AntiCheatingViolation[]>([]);
  const [departureCount, setDepartureCount] = useState(0);
  const [multiScreenDetected, setMultiScreenDetected] = useState(false);
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  const addViolation = useCallback((violation: AntiCheatingViolation) => {
    setViolations((prev) => [...prev, violation]);
    onViolationRef.current?.(violation);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Debounced departures: only count if the page stays hidden / unfocused
    // for >= DEPARTURE_MIN_MS (ignores quick blurs, permission bubbles,
    // fullscreen toggles), never while our own modals are open, and merge a
    // blur + visibility pair into one departure.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRecorded = 0;
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const schedule = (detail: string) => {
      if (timer || detectionsSuppressed()) return;
      timer = setTimeout(() => {
        timer = null;
        const stillAway = document.hidden || !document.hasFocus();
        if (!stillAway || detectionsSuppressed()) return;
        const now = Date.now();
        if (now - lastRecorded < 3000) return;
        lastRecorded = now;
        setDepartureCount((prev) => prev + 1);
        addViolation({ type: "page_departure", timestamp: now, detail });
      }, DEPARTURE_MIN_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) schedule("Tab hidden / switched away");
      else cancel();
    };
    const handleBlur = () => schedule("Interview window lost focus");
    const handleFocus = () => cancel();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancel();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled, addViolation]);

  useEffect(() => {
    if (!enabled) return;

    const internalCopies = new Set<string>();

    const trackText = (text: string | undefined | null) => {
      const trimmed = text?.trim();
      if (trimmed) internalCopies.add(trimmed);
    };

    const getSelectionText = (): string => {
      const sel = window.getSelection()?.toString()?.trim();
      if (sel) return sel;
      const el = document.activeElement;
      if (
        (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) &&
        el.selectionStart != null &&
        el.selectionEnd != null
      ) {
        return el.value.substring(el.selectionStart, el.selectionEnd).trim();
      }
      return "";
    };

    const handleCopy = (e: ClipboardEvent) => {
      trackText(getSelectionText());
      trackText(e.clipboardData?.getData("text/plain"));
    };

    const handlePaste = (e: ClipboardEvent) => {
      const pastedText = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (!pastedText || internalCopies.has(pastedText)) return;
      e.preventDefault();
      e.stopPropagation();
      addViolation({
        type: "paste",
        timestamp: Date.now(),
        detail: "External content pasted",
      });
    };

    // Intercept DataTransfer.setData to catch editors (e.g. Monaco) that
    // write selected text via clipboardData.setData() in their own copy/cut
    // handlers, which run after our capture-phase listener.
    const origSetData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format: string, data: string) {
      if (format === "text/plain" || format === "text") trackText(data);
      return origSetData.call(this, format, data);
    };

    // Also intercept Clipboard API writeText for editors that bypass
    // DOM copy events entirely.
    const origWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (origWriteText) {
      navigator.clipboard.writeText = (text: string) => {
        trackText(text);
        return origWriteText(text);
      };
    }

    document.addEventListener("copy", handleCopy, true);
    document.addEventListener("cut", handleCopy, true);
    document.addEventListener("paste", handlePaste, true);

    return () => {
      DataTransfer.prototype.setData = origSetData;
      if (origWriteText) navigator.clipboard.writeText = origWriteText;
      document.removeEventListener("copy", handleCopy, true);
      document.removeEventListener("cut", handleCopy, true);
      document.removeEventListener("paste", handlePaste, true);
    };
  }, [enabled, addViolation]);

  useEffect(() => {
    if (!enabled) return;

    const checkScreens = () => {
      if (typeof window === "undefined") return;

      const screen = window.screen as Screen & { availLeft?: number };
      const hasMultiple =
        screen.availWidth > screen.width ||
        (screen.availLeft !== undefined && screen.availLeft !== 0);

      if (hasMultiple && !multiScreenDetected) {
        setMultiScreenDetected(true);
        addViolation({
          type: "multi_screen",
          timestamp: Date.now(),
          detail: `Multiple screens detected (${window.screen.availWidth}x${window.screen.availHeight})`,
        });
      }
    };

    const screenDetails = (window as unknown as { getScreenDetails?: () => Promise<{ screens: unknown[] }> })
      .getScreenDetails;
    if (screenDetails) {
      screenDetails()
        .then((details) => {
          if (details.screens.length > 1) {
            setMultiScreenDetected(true);
            addViolation({
              type: "multi_screen",
              timestamp: Date.now(),
              detail: `${details.screens.length} screens detected via Screen API`,
            });
          }
        })
        .catch(() => {
          checkScreens();
        });
    } else {
      checkScreens();
    }

    const interval = setInterval(checkScreens, 10000);
    return () => clearInterval(interval);
  }, [enabled, multiScreenDetected, addViolation]);

  return { violations, departureCount, multiScreenDetected };
}
