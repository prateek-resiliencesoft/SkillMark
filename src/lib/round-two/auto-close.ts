import { speakerRoleForIdentity } from "./types";

/** How long the room may stay empty before Round 2 is closed. Override with ROUND2_AUTO_CLOSE_GRACE_S. */
export const AUTO_CLOSE_DEFAULT_GRACE_S = 30;
const MIN_GRACE_S = 5;
const MAX_GRACE_S = 3600;

/**
 * Grace period in ms from an env value (seconds). Unset/invalid → 30 s. `0`, `off`, `false`
 * or `disabled` turn auto-close off (returns null). Otherwise clamped to 5 s – 1 h.
 */
export function autoCloseGraceMs(raw: string | undefined | null): number | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return AUTO_CLOSE_DEFAULT_GRACE_S * 1000;
  if (["off", "false", "disabled", "no"].includes(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return AUTO_CLOSE_DEFAULT_GRACE_S * 1000;
  if (n <= 0) return null;
  return Math.round(Math.min(MAX_GRACE_S, Math.max(MIN_GRACE_S, n)) * 1000);
}

/** The candidate and panelists in a room. The transcriber agent and any other bot are ignored. */
export function humanIdentities(identities: string[]): string[] {
  return identities.filter((id) => speakerRoleForIdentity(id) !== null);
}

export interface PresenceState {
  /** First time a human was seen in the room (ISO) or null. */
  seenAt: string | null;
  /** When the room became empty (ISO) or null while someone is there. */
  emptySince: string | null;
}

export type PresenceAction =
  /** Nothing to write. */
  | { type: "none" }
  /** Someone is in the room: remember it, clear any empty timer. */
  | { type: "present"; seenAt: string; clearEmpty: boolean }
  /** The room just became empty: start the timer. */
  | { type: "start_empty"; emptySince: string }
  /** Empty for the whole grace period: end the round. */
  | { type: "close"; emptySince: string };

/**
 * One presence tick for a live round. Pure so the timing rules are testable.
 * - Someone present → mark seen, clear the timer (a rejoin inside the grace cancels the close).
 * - Nobody present and nobody ever was → never started, leave it alone.
 * - Nobody present, timer not running → start it.
 * - Nobody present, timer ≥ grace → close.
 */
export function decidePresence(input: {
  humans: number;
  state: PresenceState;
  now: number;
  graceMs: number | null;
}): PresenceAction {
  const { humans, state, now, graceMs } = input;
  const nowIso = new Date(now).toISOString();
  if (humans > 0) {
    if (!state.seenAt || state.emptySince) return { type: "present", seenAt: state.seenAt ?? nowIso, clearEmpty: !!state.emptySince };
    return { type: "none" };
  }
  if (graceMs === null || !state.seenAt) return { type: "none" };
  if (!state.emptySince) return { type: "start_empty", emptySince: nowIso };
  const since = Date.parse(state.emptySince);
  if (!Number.isFinite(since)) return { type: "start_empty", emptySince: nowIso };
  return now - since >= graceMs ? { type: "close", emptySince: state.emptySince } : { type: "none" };
}
