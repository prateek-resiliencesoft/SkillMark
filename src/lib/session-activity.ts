/**
 * What a candidate actually did in a session, for the recruiter panels.
 * Pure helpers: work for any status (in progress, ended early, completed).
 */
import type { PreflightEvent } from "@/lib/preflight";

type Ts = string | null | undefined;

export type DurationFields = {
  totalDurationSeconds?: number | null;
  completedAt?: Ts;
  startedAt?: Ts;
  interviewBeganAt?: Ts;
  lastActivityAt?: Ts;
  lastHeartbeatAt?: Ts;
  audioDuration?: number | null;
};

function ms(t: Ts): number | null {
  if (!t) return null;
  const v = new Date(t).getTime();
  return Number.isNaN(v) ? null : v;
}

/**
 * Stored duration, else end − start (end = completedAt → last message →
 * last activity / heartbeat), else the recording length. Null when unknown.
 */
export function effectiveDurationSeconds(s: DurationFields | null | undefined, lastMessageAt?: Ts): number | null {
  if (!s) return null;
  if (typeof s.totalDurationSeconds === "number" && s.totalDurationSeconds > 0) return s.totalDurationSeconds;
  const start = ms(s.interviewBeganAt) ?? ms(s.startedAt);
  const end = ms(s.completedAt) ?? ms(lastMessageAt) ?? ms(s.lastActivityAt) ?? ms(s.lastHeartbeatAt);
  if (start != null && end != null && end > start) {
    const sec = Math.round((end - start) / 1000);
    // Guard against a stale startedAt from days before (link opened early).
    if (sec < 6 * 3600) return sec;
  }
  if (typeof s.audioDuration === "number" && s.audioDuration > 0) return Math.round(s.audioDuration);
  return null;
}

export type ActivityMessage = {
  role: string;
  content?: string | null;
  questionId?: string | null;
  contentType?: string | null;
  timestamp?: Ts;
};

function words(t: string | null | undefined): number {
  const s = (t ?? "").trim();
  return s ? s.split(/\s+/).length : 0;
}

/** Questions with at least one candidate answer (distinct questionId; falls back to answer turns). */
export function countAnsweredQuestions(messages: ActivityMessage[]): number {
  const user = messages.filter((m) => String(m.role).toUpperCase() === "USER" && words(m.content) > 0);
  const ids = new Set(user.map((m) => m.questionId).filter((q): q is string => !!q));
  return ids.size > 0 ? ids.size : user.length;
}

export function lastMessageAt(messages: ActivityMessage[]): string | null {
  let best: number | null = null;
  let out: string | null = null;
  for (const m of messages) {
    const v = ms(m.timestamp);
    if (v != null && (best == null || v > best)) {
      best = v;
      out = m.timestamp ?? null;
    }
  }
  return out;
}

/** Short recruiter-facing note for sessions that aren't a normal completion. */
export function sessionStatusNote(status: string | null | undefined): string | null {
  switch (status) {
    case "IN_PROGRESS":
      return "Interview still in progress (or the tab was left open). Showing what has been saved so far.";
    case "ABANDONED":
      return "Ended early. Showing everything the candidate completed before leaving.";
    case "DISQUALIFIED":
      return "Disqualified. Showing what was captured before the interview was stopped.";
    default:
      return null;
  }
}

const FAREWELL = [
  /\bgood\s*bye\b/,
  /\bbye for now\b/,
  /\bhave a (?:great|good|nice) day\b/,
  /\bthank(?:s| you)(?: so much)? for your time\b/,
  /\bthat(?:'s| is) all (?:for now|from my side|the questions)\b/,
  /\bthat (?:wraps|concludes) (?:up )?(?:our|the|this)\b/,
  /\bwe will (?:be in touch|get back to you)\b/,
  /\bi wish you all the best\b/,
];

/** True when the interviewer's last line is a closing / goodbye. */
export function reachedClosing(messages: ActivityMessage[]): boolean {
  const ai = messages.filter((m) => String(m.role).toUpperCase() === "ASSISTANT" && (m.content ?? "").trim());
  const last = ai[ai.length - 1];
  if (!last) return false;
  const text = (last.content ?? "").toLowerCase();
  if (/[?？]\s*$/.test(text)) return false;
  return FAREWELL.some((r) => r.test(text));
}

/**
 * Events for the session shown in the panel: anything tagged with this
 * session, plus untagged/older rows that match the invite token (or have none).
 */
export function scopePreflightEvents(
  events: PreflightEvent[],
  opts: { sessionId?: string | null; inviteToken?: string | null },
): PreflightEvent[] {
  return events.filter((e) => {
    const ev = e as PreflightEvent & { sessionId?: string | null; inviteToken?: string | null };
    if (opts.sessionId && ev.sessionId === opts.sessionId) return true;
    if (opts.sessionId && ev.sessionId && ev.sessionId !== opts.sessionId) return false;
    if (!opts.inviteToken || !ev.inviteToken) return true;
    return ev.inviteToken === opts.inviteToken;
  });
}

/**
 * When step-by-step events are missing (older sessions, or the events table
 * isn't there yet), rebuild what the session row proves: the link was opened
 * when the session was created, and the interview began at interviewBeganAt
 * (or at the first saved message).
 */
export function derivePreflightEvents(
  session: { createdAt?: Ts; startedAt?: Ts; interviewBeganAt?: Ts } | null | undefined,
  firstMessageAt?: Ts,
): PreflightEvent[] {
  if (!session) return [];
  const out: PreflightEvent[] = [];
  const opened = session.createdAt ?? session.startedAt ?? null;
  if (opened) out.push({ type: "link_opened", status: "done", createdAt: opened, detail: { derived: true } } as PreflightEvent);
  const began = session.interviewBeganAt ?? firstMessageAt ?? null;
  if (began) out.push({ type: "interview_started", status: "done", createdAt: began, detail: { derived: true } } as PreflightEvent);
  return out;
}
