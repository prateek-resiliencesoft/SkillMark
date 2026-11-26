/**
 * Candidate details: which interview round is shown, and the stage / next-action summary.
 * Pure helpers (client + server safe, no React) so the round switch is testable.
 *
 * Round 1 = the AI voice interview (a session). Round 2 = the live panel interview
 * (a `round_two_interviews` row, possibly several attempts; the newest wins).
 */

export type RoundNumber = 1 | 2;
export const ROUND_QUERY_PARAM = "round";

/** Minimal Round 1 facts the switcher needs (from the candidate's session). */
export interface Round1Facts {
  /** Session status: COMPLETED, IN_PROGRESS, ABANDONED, DISQUALIFIED, NOT_STARTED… */
  status: string | null | undefined;
  /** Overall 0-10 score, when scored. */
  score: number | null | undefined;
  /** Human decision on Round 1: approved | rejected | followup_sent | none | null. */
  decision: string | null | undefined;
  /** True once there is a session to look at. */
  hasSession: boolean;
}

/** One Round 2 attempt, as returned by `roundTwo.roundsForCandidate`. */
export interface Round2Facts {
  id: string;
  status: string; // draft | scheduled | live | ended | cancelled | no_show
  reportStatus: string; // none | pending | generating | ready | failed
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  title?: string | null;
  overallScore: number | null;
  recommendation: string | null;
}

export type TabTone = "neutral" | "info" | "live" | "success" | "warning" | "danger";

export interface RoundTab {
  round: RoundNumber;
  label: string;
  /** Short second line, e.g. "AI voice" / "Live panel". */
  kind: string;
  /** Status text for the badge. */
  status: string;
  tone: TabTone;
  /** "7.5" style score, when there is one. */
  score: string | null;
  /** Round exists and can be opened. */
  available: boolean;
  /** Round is happening / needs attention now. */
  active: boolean;
}

export interface NextAction {
  label: string;
  /** What the UI should offer for it. */
  kind: "wait" | "review_r1" | "schedule_r2" | "finish_r2" | "open_r2" | "join_r2" | "review_r2" | "reschedule_r2" | "none";
}

export interface TimelineStep {
  key: string;
  label: string;
  state: "done" | "current" | "todo" | "failed";
  detail?: string | null;
}

export function parseRoundParam(value: string | null | undefined): RoundNumber | null {
  if (value === "1" || value === "2") return Number(value) as RoundNumber;
  return null;
}

/** The newest Round 2 attempt (input order does not matter). */
export function latestRound2<T extends { createdAt: string | null }>(rounds: readonly T[] | null | undefined): T | null {
  if (!rounds?.length) return null;
  return [...rounds].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0))[0] ?? null;
}

const R2_ACTIVE = new Set(["scheduled", "live"]);
/** R2 statuses that mean "this round is the current stage" (so open on it). */
const R2_CURRENT = new Set(["scheduled", "live", "ended", "no_show"]);

export function fmtScore(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : null;
}

function r1Presentation(r1: Round1Facts): Pick<RoundTab, "status" | "tone" | "active" | "available"> {
  const s = String(r1.status ?? "NOT_STARTED").toUpperCase();
  if (!r1.hasSession) return { status: "Not started", tone: "neutral", active: false, available: true };
  switch (s) {
    case "COMPLETED":
      return { status: "Completed", tone: "success", active: false, available: true };
    case "IN_PROGRESS":
      return { status: "In progress", tone: "info", active: true, available: true };
    case "ABANDONED":
      return { status: "Left early", tone: "warning", active: false, available: true };
    case "DISQUALIFIED":
      return { status: "Disqualified", tone: "danger", active: false, available: true };
    default:
      return { status: "Not started", tone: "neutral", active: false, available: true };
  }
}

function r2Presentation(r2: Round2Facts): Pick<RoundTab, "status" | "tone" | "active"> {
  switch (r2.status) {
    case "live":
      return { status: "Live now", tone: "live", active: true };
    case "scheduled":
      return { status: "Scheduled", tone: "info", active: true };
    case "ended":
      if (r2.reportStatus === "ready") return { status: "Report ready", tone: "success", active: false };
      if (r2.reportStatus === "failed") return { status: "Report failed", tone: "danger", active: true };
      return { status: "Report pending", tone: "warning", active: true };
    case "no_show":
      return { status: "No-show", tone: "warning", active: true };
    case "cancelled":
      return { status: "Cancelled", tone: "neutral", active: false };
    case "draft":
      return { status: "Draft", tone: "neutral", active: false };
    default:
      return { status: r2.status || "Unknown", tone: "neutral", active: false };
  }
}

/** Tabs for the switcher. Round 2 is only listed once a round 2 exists (even a draft). */
export function buildRoundTabs(r1: Round1Facts, r2: Round2Facts | null): RoundTab[] {
  const p1 = r1Presentation(r1);
  const tabs: RoundTab[] = [
    { round: 1, label: "Round 1", kind: "AI voice", ...p1, score: fmtScore(r1.score) },
  ];
  if (r2) {
    const p2 = r2Presentation(r2);
    tabs.push({
      round: 2,
      label: "Round 2",
      kind: "Live panel",
      ...p2,
      score: r2.status === "ended" && r2.reportStatus === "ready" ? fmtScore(r2.overallScore) : null,
      available: true,
    });
  }
  return tabs;
}

/** Round to open when the URL has no (valid) `?round=`: the latest one that is in progress or done. */
export function defaultRound(r2: Round2Facts | null): RoundNumber {
  return r2 && R2_CURRENT.has(r2.status) ? 2 : 1;
}

/** `?round=` wins when that round exists; otherwise the default (never an empty tab). */
export function resolveActiveRound(param: string | null | undefined, tabs: readonly RoundTab[], r2: Round2Facts | null): RoundNumber {
  const wanted = parseRoundParam(param);
  if (wanted && tabs.some((t) => t.round === wanted && t.available)) return wanted;
  return defaultRound(r2);
}

/** Query string with `round` set (null removes it); other params are kept. Returns "" or "?a=b". */
export function withRoundParam(search: string | URLSearchParams, round: RoundNumber | null): string {
  const p = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (round == null) p.delete(ROUND_QUERY_PARAM);
  else p.set(ROUND_QUERY_PARAM, String(round));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Where the candidate is overall, and the one thing to do next. */
export function nextAction(r1: Round1Facts, r2: Round2Facts | null): NextAction {
  if (r2) {
    switch (r2.status) {
      case "live":
        return { label: "Round 2 is live: join the room", kind: "join_r2" };
      case "scheduled":
        return { label: "Round 2 is scheduled", kind: "open_r2" };
      case "ended":
        if (r2.reportStatus === "ready") return { label: "Review the Round 2 report and decide", kind: "review_r2" };
        if (r2.reportStatus === "failed") return { label: "Round 2 report failed: retry it", kind: "review_r2" };
        return { label: "Round 2 report is being generated", kind: "wait" };
      case "no_show":
      case "cancelled":
        return { label: "Reschedule Round 2", kind: "reschedule_r2" };
      case "draft":
        return { label: "Finish scheduling Round 2", kind: "finish_r2" };
      default:
        break;
    }
  }
  const s = String(r1.status ?? "NOT_STARTED").toUpperCase();
  if (!r1.hasSession || s === "NOT_STARTED") return { label: "Waiting for the candidate to start Round 1", kind: "wait" };
  if (s === "IN_PROGRESS") return { label: "Round 1 is in progress", kind: "wait" };
  if (s === "COMPLETED") {
    if (r1.decision === "approved") return { label: "Schedule Round 2", kind: "schedule_r2" };
    if (r1.decision === "rejected") return { label: "Rejected after Round 1", kind: "none" };
    return { label: "Review Round 1 and approve or reject", kind: "review_r1" };
  }
  if (s === "DISQUALIFIED") return { label: "Disqualified in Round 1", kind: "none" };
  return { label: "Round 1 was left early: follow up if needed", kind: "none" };
}

/** Short pipeline: Round 1 → Decision → Round 2 → Report. */
export function buildTimeline(r1: Round1Facts, r2: Round2Facts | null): TimelineStep[] {
  const s1 = String(r1.status ?? "NOT_STARTED").toUpperCase();
  const r1Done = s1 === "COMPLETED";
  const r1Failed = s1 === "DISQUALIFIED" || s1 === "ABANDONED";
  const decided = r1.decision === "approved" || r1.decision === "rejected";
  const steps: TimelineStep[] = [
    {
      key: "r1",
      label: "Round 1 · AI voice",
      state: r1Done ? "done" : r1Failed ? "failed" : r1.hasSession ? "current" : "todo",
      detail: fmtScore(r1.score) ? `Score ${fmtScore(r1.score)}` : null,
    },
    {
      key: "decision",
      label: "Decision",
      state: r1.decision === "rejected" ? "failed" : decided ? "done" : r1Done && !r2 ? "current" : r2 ? "done" : "todo",
      detail: r1.decision === "approved" ? "Approved" : r1.decision === "rejected" ? "Rejected" : null,
    },
  ];
  if (r2 || r1.decision === "approved") {
    const live = r2?.status === "live";
    const finished = r2?.status === "ended";
    const bad = r2?.status === "no_show" || r2?.status === "cancelled";
    steps.push({
      key: "r2",
      label: "Round 2 · Live panel",
      state: finished ? "done" : bad ? "failed" : r2 && (live || r2.status === "scheduled") ? "current" : "todo",
      detail: r2 ? r2Presentation(r2).status : "Not scheduled",
    });
    steps.push({
      key: "report",
      label: "Round 2 report",
      state: r2?.reportStatus === "ready" ? "done" : r2?.reportStatus === "failed" ? "failed" : finished ? "current" : "todo",
      detail: r2?.reportStatus === "ready" ? (r2.recommendation ?? null) : null,
    });
  }
  return steps;
}

/**
 * One list-cell status for a candidate: the latest round that has started, labelled by round.
 * Used so a candidate with a Round 2 doesn't keep showing only the stale Round 1 result.
 */
export function latestRoundStatus(
  r1Label: string,
  r2: { status: string; reportStatus?: string | null } | null | undefined,
): { round: RoundNumber; label: string } {
  if (r2 && R2_CURRENT.has(r2.status)) {
    const p = r2Presentation({
      id: "",
      status: r2.status,
      reportStatus: r2.reportStatus ?? "none",
      scheduledAt: null,
      startedAt: null,
      endedAt: null,
      createdAt: null,
      overallScore: null,
      recommendation: null,
    });
    return { round: 2, label: p.status };
  }
  return { round: 1, label: r1Label };
}

export const isR2Active = (r2: Round2Facts | null) => !!r2 && R2_ACTIVE.has(r2.status);
