/**
 * Pre-interview activity: events recorded from invite-link open until
 * the interview actually starts (interviewBeganAt).
 */

export const DEFAULT_PREFLIGHT_STALE_MS = 30 * 60_000;

/** Server may tighten/widen via PREFLIGHT_STALE_MINUTES; client stays at 30 min. */
export function preflightStaleMs(): number {
  const raw =
    typeof process !== "undefined" ? process.env.PREFLIGHT_STALE_MINUTES : undefined;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.round(n * 60_000);
  return DEFAULT_PREFLIGHT_STALE_MS;
}

export const PREFLIGHT_EVENT_TYPES = [
  "link_opened",
  "consent_accepted",
  "camera_permission",
  "photo_captured",
  "mic_permission",
  "speaker_test",
  "mic_check",
  "screen_share",
  "tour",
  "interview_started",
  "error",
  "heartbeat",
] as const;

export type PreflightEventType = (typeof PREFLIGHT_EVENT_TYPES)[number];

export const PREFLIGHT_EVENT_STATUSES = [
  "done",
  "granted",
  "denied",
  "passed",
  "failed",
  "skipped",
  "played",
  "started",
  "stopped",
  "shown",
  "error",
] as const;

export type PreflightEventStatus = (typeof PREFLIGHT_EVENT_STATUSES)[number];

export function isPreflightEventType(value: string): value is PreflightEventType {
  return (PREFLIGHT_EVENT_TYPES as readonly string[]).includes(value);
}

export function isPreflightEventStatus(value: string): value is PreflightEventStatus {
  return (PREFLIGHT_EVENT_STATUSES as readonly string[]).includes(value);
}

export const PREFLIGHT_STEPS: { type: Exclude<PreflightEventType, "error" | "heartbeat">; label: string }[] = [
  { type: "link_opened", label: "Opened link" },
  { type: "consent_accepted", label: "Accepted terms" },
  { type: "camera_permission", label: "Camera permission" },
  { type: "photo_captured", label: "Photo captured" },
  { type: "mic_permission", label: "Microphone permission" },
  { type: "speaker_test", label: "Speaker test" },
  { type: "mic_check", label: "Voice check" },
  { type: "screen_share", label: "Screen share" },
  { type: "tour", label: "Tour" },
  { type: "interview_started", label: "Interview started" },
];

export const PREFLIGHT_STEP_LABELS: Record<string, string> = Object.fromEntries(
  PREFLIGHT_STEPS.map((s) => [s.type, s.label]),
);

export type PreflightEvent = {
  id?: string;
  type: string;
  status: string;
  detail?: Record<string, unknown> | null;
  createdAt: string;
  inviteToken?: string | null;
  sessionId?: string | null;
};

export type PreflightSessionFields = {
  status?: string | null;
  interviewBeganAt?: string | null;
  lastActivityAt?: string | null;
  lastHeartbeatAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
  preflightStep?: string | null;
};

/** Last time we heard from the candidate during onboarding (before the interview begins). */
export function preflightLastActivityAt(s: PreflightSessionFields): string | null {
  return s.lastActivityAt ?? s.startedAt ?? s.createdAt ?? null;
}

/** True when the candidate opened the link / started setup but then went quiet. */
export function isPreflightStale(
  s: PreflightSessionFields,
  nowMs: number = Date.now(),
  staleMs: number = preflightStaleMs(),
): boolean {
  if (s.status !== "IN_PROGRESS" || s.interviewBeganAt) return false;
  const last = preflightLastActivityAt(s);
  if (!last) return false;
  return nowMs - new Date(last).getTime() > staleMs;
}

/** Whether a repeat of this type+status should be dropped. */
export function shouldDedupePreflightEvent(
  type: string,
  status: string,
  lastSame?: { status: string; createdAt: string } | null,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSame) return false;
  const elapsed = nowMs - new Date(lastSame.createdAt).getTime();
  const retries = type === "error" || (type === "mic_check" && status === "failed");
  if (retries) return elapsed < 2_000;
  if (type === "heartbeat") return elapsed < 60_000;
  if (type === "link_opened") return true;
  if (type === "consent_accepted" || type === "interview_started") return true;
  return lastSame.status === status;
}

export type TimelineItem = {
  type: string;
  label: string;
  status: string | null;
  at: string | null;
  ok: boolean;
  pending: boolean;
  problem: boolean;
  retries?: number;
};

export function buildPreflightTimeline(
  events: PreflightEvent[],
  inviteToken?: string | null,
): TimelineItem[] {
  const scoped = inviteToken
    ? events.filter((e) => !e.inviteToken || e.inviteToken === inviteToken)
    : events;
  const byType = new Map<string, PreflightEvent[]>();
  for (const e of scoped) {
    if (e.type === "error" || e.type === "heartbeat") continue;
    const list = byType.get(e.type) ?? [];
    list.push(e);
    byType.set(e.type, list);
  }

  return PREFLIGHT_STEPS.map((step) => {
    const list = byType.get(step.type) ?? [];
    const last = list[list.length - 1] ?? null;
    const status = last?.status ?? null;
    const problem =
      status === "denied" || status === "failed" || status === "error";
    const ok =
      status === "done" ||
      status === "granted" ||
      status === "passed" ||
      status === "played" ||
      status === "started" ||
      status === "shown" ||
      status === "skipped" ||
      status === "stopped";
    const retries = step.type === "mic_check"
      ? list.filter((e) => e.status === "failed").length
      : undefined;
    return {
      type: step.type,
      label: step.label,
      status,
      at: last?.createdAt ?? null,
      ok,
      pending: !last,
      problem,
      retries,
    };
  });
}

export function preflightStuckStep(items: TimelineItem[]): TimelineItem | null {
  const problem = [...items].reverse().find((i) => i.problem);
  if (problem) return problem;
  const started = items.filter((i) => !i.pending);
  if (started.length === 0) return null;
  const lastDone = started[started.length - 1];
  if (lastDone.type === "interview_started" && lastDone.ok) return null;
  const next = items.find((i) => i.pending);
  return next ?? lastDone;
}

export function latestPreflightActivity(events: PreflightEvent[]): string | null {
  let last: string | null = null;
  for (const e of events) {
    if (e.type === "heartbeat") continue;
    if (!last || e.createdAt > last) last = e.createdAt;
  }
  return last;
}

export function formatRelativeAgo(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** Recruiter-facing status: don't say "In Progress" until the interview has begun. */
export function formatSessionStatusLabel(
  session: PreflightSessionFields | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!session) return "Not Started";
  const status = session.status ?? "";
  if (status === "COMPLETED") return "Completed";
  if (status === "ABANDONED") return "Abandoned";
  if (status === "DISQUALIFIED") return "Disqualified";
  if (status === "IN_PROGRESS") {
    if (isPreflightStale(session, nowMs)) return "Abandoned";
    if (!session.interviewBeganAt) {
      const step = session.preflightStep;
      if (!step || step === "link_opened") return "Opened link";
      if (step === "interview_started") return "In Progress";
      return "Setting up";
    }
    return "In Progress";
  }
  if (status === "NOT_STARTED" || !status) return "Not Started";
  return status.replaceAll("_", " ");
}

export type DeviceInfo = {
  userAgent?: string;
  language?: string;
  platform?: string;
  vendor?: string;
  timezone?: string;
  screen?: { width: number; height: number };
};

export function collectDeviceInfo(): DeviceInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return {
    userAgent: nav.userAgent,
    language: nav.language,
    platform: nav.userAgentData?.platform || nav.platform,
    vendor: nav.vendor,
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
    screen:
      typeof screen !== "undefined"
        ? { width: screen.width, height: screen.height }
        : undefined,
  };
}

export function formatDeviceInfo(device: DeviceInfo | null | undefined): string | null {
  if (!device) return null;
  const parts: string[] = [];
  const ua = device.userAgent ?? "";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? "Safari"
    : ua ? "Browser" : null;
  if (browser) parts.push(browser);
  const os =
    device.platform ||
    (/Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : null);
  if (os) parts.push(os);
  if (device.screen?.width && device.screen?.height) {
    parts.push(`${device.screen.width}×${device.screen.height}`);
  }
  if (device.timezone) parts.push(device.timezone);
  return parts.length ? parts.join(" · ") : null;
}

export function mediaErrorCode(err: unknown): "permission_denied" | "device_not_found" | "device_in_use" | "unknown" {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "device_not_found";
  if (name === "NotReadableError") return "device_in_use";
  return "unknown";
}
