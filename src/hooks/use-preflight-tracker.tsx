"use client";

import {
  collectDeviceInfo,
  type PreflightEventStatus,
  type PreflightEventType,
} from "@/lib/preflight";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

type ReportFn = (
  type: PreflightEventType,
  status: PreflightEventStatus,
  detail?: Record<string, unknown>,
) => void;

const PreflightContext = createContext<ReportFn>(() => {});

export function usePreflightReport(): ReportFn {
  return useContext(PreflightContext);
}

export function PreflightProvider({
  token,
  sessionId,
  children,
}: {
  token?: string;
  sessionId?: string;
  children: ReactNode;
}) {
  const report = useCallback<ReportFn>(
    (type, status, detail) => {
      if (!token && !sessionId) return;
      const body = {
        token,
        sessionId,
        type,
        status,
        detail,
        device: collectDeviceInfo(),
      };
      void fetch("/api/session/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    },
    [token, sessionId],
  );

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    if (!token && !sessionId) return;
    opened.current = true;
    report("link_opened", "done");
  }, [report, token, sessionId]);

  useEffect(() => {
    if (!token && !sessionId) return;
    const id = window.setInterval(() => report("heartbeat", "done"), 120_000);
    return () => window.clearInterval(id);
  }, [report, token, sessionId]);

  return <PreflightContext.Provider value={report}>{children}</PreflightContext.Provider>;
}
