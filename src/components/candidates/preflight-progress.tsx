"use client";

import {
  buildPreflightTimeline,
  formatDeviceInfo,
  formatRelativeAgo,
  latestPreflightActivity,
  preflightStuckStep,
  type DeviceInfo,
  type PreflightEvent,
} from "@/lib/preflight";
import { cn } from "@/lib/utils";

function statusText(item: { status: string | null; pending: boolean; retries?: number }): string {
  if (item.pending) return "Not yet";
  const base =
    item.status === "done" ? "Done"
    : item.status === "granted" ? "Granted"
    : item.status === "denied" ? "Denied"
    : item.status === "passed" ? "Passed"
    : item.status === "failed" ? "Failed"
    : item.status === "skipped" ? "Skipped"
    : item.status === "played" ? "Played"
    : item.status === "started" ? "Started"
    : item.status === "stopped" ? "Stopped"
    : item.status === "shown" ? "Shown"
    : item.status === "error" ? "Error"
    : item.status ?? "";
  if (item.retries && item.retries > 0) return `${base} (${item.retries} ${item.retries === 1 ? "retry" : "retries"})`;
  return base;
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function PreflightProgress({
  events,
  inviteToken,
  device,
  lastActivityAt,
}: {
  events: PreflightEvent[] | null | undefined;
  inviteToken?: string | null;
  device?: DeviceInfo | null;
  lastActivityAt?: string | null;
}) {
  const list = Array.isArray(events) ? events : [];
  const items = buildPreflightTimeline(list, inviteToken);
  const stuck = preflightStuckStep(items);
  const last = latestPreflightActivity(list) ?? lastActivityAt ?? null;
  const ago = formatRelativeAgo(last);
  const deviceLabel = formatDeviceInfo(device);
  const errors = list.filter((e) => e.type === "error" && (!inviteToken || !e.inviteToken || e.inviteToken === inviteToken));
  const hasAny = list.some((e) => e.type !== "heartbeat" && (!inviteToken || !e.inviteToken || e.inviteToken === inviteToken));

  if (!hasAny && !lastActivityAt) {
    return (
      <div className="mt-3 border-t pt-3">
        <h5 className="text-xs font-semibold">Pre-interview progress</h5>
        <p className="mt-1 text-xs text-muted-foreground">The candidate has not opened the link yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h5 className="text-xs font-semibold">Pre-interview progress</h5>
        {ago && <span className="shrink-0 text-[11px] text-muted-foreground">Last activity {ago}</span>}
      </div>
      {stuck && stuck.type !== "interview_started" && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          {stuck.problem ? `Stuck at ${stuck.label.toLowerCase()}` : `Currently at ${stuck.label.toLowerCase()}`}
        </p>
      )}
      <ol className="space-y-1">
        {items.map((item) => (
          <li key={item.type} className="flex items-baseline gap-2 text-xs">
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                item.ok && !item.problem ? "bg-emerald-600" : item.problem ? "bg-destructive" : "bg-muted-foreground/30",
              )}
            />
            <span className="min-w-0 flex-1">{item.label}</span>
            <span
              className={cn(
                "shrink-0",
                item.problem ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {statusText(item)}
              {item.at ? ` · ${fmtTime(item.at)}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {errors.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[11px] text-destructive">
          {errors.slice(-4).map((e, i) => {
            const detail = (e.detail ?? {}) as Record<string, unknown>;
            const code = typeof detail.code === "string" ? detail.code.replaceAll("_", " ") : "error";
            const source = typeof detail.source === "string" ? detail.source : "";
            return (
              <p key={e.id ?? i}>
                {fmtTime(e.createdAt) ? `${fmtTime(e.createdAt)} · ` : ""}
                {source ? `${source}: ` : ""}
                {code}
              </p>
            );
          })}
        </div>
      )}
      {deviceLabel && (
        <p className="mt-2 text-[11px] text-muted-foreground">{deviceLabel}</p>
      )}
    </div>
  );
}
