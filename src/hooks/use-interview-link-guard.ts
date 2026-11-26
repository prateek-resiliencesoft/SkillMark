"use client";

import { useEffect, useRef } from "react";
import { HEARTBEAT_GRACE_MS, HEARTBEAT_INTERVAL_MS } from "@/lib/session-link";

/**
 * Keeps a one-time interview link alive while the interview is open.
 *  - heartbeat every few seconds,
 *  - beacon "abandon" when the tab is closed/left,
 *  - local cut-off when the connection has been gone longer than the grace window.
 * `onExpired` fires at most once.
 */
export function useInterviewLinkGuard(opts: {
  sessionId: string | undefined;
  active: boolean;
  onExpired: () => void;
  /** True once the interview is finishing: no abandon beacon, no cut-off. */
  isEnding?: () => boolean;
}) {
  const { sessionId, active, onExpired } = opts;
  const expiredRef = useRef(false);
  const cbRef = useRef(onExpired);
  cbRef.current = onExpired;
  const endingRef = useRef(opts.isEnding);
  endingRef.current = opts.isEnding;

  useEffect(() => {
    if (!active || !sessionId) return;
    expiredRef.current = false;
    let lastOkAt = Date.now();
    let stopped = false;

    const expire = () => {
      if (expiredRef.current) return;
      // Finishing (saving / uploading): never cut the interview off here, or
      // the completion save would be lost and the session left Abandoned.
      if (endingRef.current?.()) return;
      expiredRef.current = true;
      stopped = true;
      cbRef.current();
    };

    const beat = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/session/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          keepalive: true,
        });
        if (res.ok) {
          lastOkAt = Date.now();
          const data = (await res.json().catch(() => ({}))) as { expired?: boolean };
          if (data.expired) expire();
          return;
        }
      } catch {
        /* offline — handled below */
      }
      if (Date.now() - lastOkAt > HEARTBEAT_GRACE_MS) expire();
    };

    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);

    const onPageHide = () => {
      if (expiredRef.current) return;
      // A finished interview completes via its own beacon, never "abandon".
      if (endingRef.current?.()) return;
      const blob = new Blob([JSON.stringify({ sessionId })], { type: "application/json" });
      navigator.sendBeacon("/api/session/abandon", blob);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [active, sessionId]);
}
