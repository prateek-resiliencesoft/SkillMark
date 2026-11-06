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
}) {
  const { sessionId, active, onExpired } = opts;
  const expiredRef = useRef(false);
  const cbRef = useRef(onExpired);
  cbRef.current = onExpired;

  useEffect(() => {
    if (!active || !sessionId) return;
    expiredRef.current = false;
    let lastOkAt = Date.now();
    let stopped = false;

    const expire = () => {
      if (expiredRef.current) return;
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
