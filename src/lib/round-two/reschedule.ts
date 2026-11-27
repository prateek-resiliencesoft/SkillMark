/** Round 2 reschedule rules and IST date helpers (pure, shared by server and UI). */

export const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";
const IST_OFFSET_MS = 5.5 * 3600_000;

/** Statuses where Round 2 is over (or never happened) and a new attempt is created. */
const NEW_ATTEMPT_STATUSES = ["ended", "cancelled", "no_show"] as const;
/** Statuses that have not started: the time/link is changed on the same round. */
const IN_PLACE_STATUSES = ["draft", "scheduled"] as const;

export type RescheduleMode = "new_attempt" | "in_place";

/**
 * What "Reschedule Round 2" does for a round, or null when it is not offered (a live round
 * must be ended first). A round whose report failed is `ended`, so it creates a new attempt.
 * An expired round is still `scheduled`, so its time is simply changed.
 */
export function rescheduleMode(status: string): RescheduleMode | null {
  if ((NEW_ATTEMPT_STATUSES as readonly string[]).includes(status)) return "new_attempt";
  if ((IN_PLACE_STATUSES as readonly string[]).includes(status)) return "in_place";
  return null;
}

export function canReschedule(status: string): boolean {
  return rescheduleMode(status) !== null;
}

/** A scheduled round whose window has passed without anyone starting it. */
export function isRoundExpired(round: { status: string; scheduledAt: string | null; durationMin: number }, now = Date.now()): boolean {
  if (round.status !== "scheduled" || !round.scheduledAt) return false;
  const start = Date.parse(round.scheduledAt);
  return Number.isFinite(start) && now > start + round.durationMin * 60_000;
}

/** "2026-11-28T15:30" typed as IST wall-clock → UTC ISO string. Null when empty or invalid. */
export function istInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${IST_OFFSET}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" in IST, for a datetime-local input. */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

export function formatIst(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Not set";
  return `${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST_TIME_ZONE }).format(new Date(iso))} IST`;
}

/** Default suggestion: tomorrow at the top of the same IST hour. */
export function defaultRescheduleInput(now = Date.now()): string {
  const istMs = now + 24 * 3600_000 + IST_OFFSET_MS;
  return new Date(Math.floor(istMs / 3600_000) * 3600_000).toISOString().slice(0, 16);
}
