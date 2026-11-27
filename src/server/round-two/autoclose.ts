import "server-only";
import { closeRoom, liveKitConfig, listRoomIdentitiesStrict } from "@/lib/livekit";
import { createLogger } from "@/lib/logger";
import { autoCloseGraceMs, decidePresence, humanIdentities, type PresenceState } from "@/lib/round-two/auto-close";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runRoundTwoReport } from "./report";

const log = createLogger("round-two/autoclose");

const COLUMNS = 'id, "livekitRoom", "roomSeenAt", "roomEmptySince"';
const LEGACY_COLUMNS = 'id, "livekitRoom"';

/** Used only until migration 55 is applied (columns missing): presence kept per process. */
const memory = new Map<string, PresenceState>();

const missingColumn = (e: { code?: string; message?: string } | null) => !!e && /roomSeenAt|roomEmptySince|endReason|42703|PGRST204/.test(`${e.code} ${e.message}`);

export interface EndRoundOptions {
  reason: "auto_empty";
  /** Only end the round if it is still live (and, when given, still empty since this time). */
  emptySince?: string | null;
}

export interface AutoCloseDeps {
  /** Starts the media → transcript → report chain. Defaults to runRoundTwoReport (tests pass a stub). */
  runReport?: (roundId: string) => unknown;
}

/**
 * Ends a live round the same way the host's "End round" does: status ended, report pending
 * (the report job then waits for the recording, builds the transcript and writes the report),
 * and the LiveKit room is closed. Guarded on status = live so a second caller is a no-op.
 * Returns true when this call ended it.
 */
export async function endLiveRound(roundId: string, livekitRoom: string, opts: EndRoundOptions, deps: AutoCloseDeps = {}): Promise<boolean> {
  const now = new Date().toISOString();
  const patch = {
    status: "ended",
    endedAt: now,
    reportStatus: "pending",
    reportAttempts: 0,
    updatedAt: now,
  };
  const run = (extra: Record<string, unknown>) => {
    let q = supabaseAdmin.from("round_two_interviews").update({ ...patch, ...extra }).eq("id", roundId).eq("status", "live");
    // Still empty since the same moment: a rejoin that cleared the timer wins.
    if (opts.emptySince) q = q.eq("roomEmptySince", opts.emptySince);
    return q.select("id");
  };
  let { data, error } = await run({ endReason: opts.reason });
  if (missingColumn(error)) {
    // Pre-migration 55: no endReason / roomEmptySince.
    ({ data, error } = await supabaseAdmin
      .from("round_two_interviews")
      .update(patch)
      .eq("id", roundId)
      .eq("status", "live")
      .select("id"));
  }
  if (error) {
    log.error("auto-close update failed", roundId, error.message);
    return false;
  }
  if (!data || data.length === 0) return false;
  memory.delete(roundId);
  if (liveKitConfig()) await closeRoom(livekitRoom);
  void (deps.runReport ?? runRoundTwoReport)(roundId);
  return true;
}

async function loadLive(): Promise<{ id: string; livekitRoom: string; state: PresenceState | null }[]> {
  let res = await supabaseAdmin.from("round_two_interviews").select(COLUMNS).eq("status", "live").limit(200);
  if (missingColumn(res.error)) {
    res = (await supabaseAdmin.from("round_two_interviews").select(LEGACY_COLUMNS).eq("status", "live").limit(200)) as typeof res;
    return ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      livekitRoom: r.livekitRoom as string,
      state: null,
    }));
  }
  return ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    livekitRoom: r.livekitRoom as string,
    state: { seenAt: (r.roomSeenAt as string | null) ?? null, emptySince: (r.roomEmptySince as string | null) ?? null },
  }));
}

async function writeState(id: string, patch: Record<string, string | null>, fallback: PresenceState): Promise<void> {
  const { error } = await supabaseAdmin.from("round_two_interviews").update(patch).eq("id", id).eq("status", "live");
  if (error) {
    if (missingColumn(error)) memory.set(id, fallback);
    else log.warn("presence update failed", id, error.message);
  }
}

/**
 * One pass over every live Round 2: when no candidate or panelist is in the LiveKit room for the
 * whole grace period (default 30 s, ROUND2_AUTO_CLOSE_GRACE_S), the round is ended. Idempotent;
 * a rejoin inside the grace clears the timer. Rounds nobody ever entered are left alone.
 * Returns the ids it closed.
 */
export async function sweepRoundTwoPresence(now = Date.now(), deps: AutoCloseDeps = {}): Promise<string[]> {
  const graceMs = autoCloseGraceMs(process.env.ROUND2_AUTO_CLOSE_GRACE_S);
  if (graceMs === null || !liveKitConfig()) return [];
  const rounds = await loadLive();
  const closed: string[] = [];
  const liveIds = new Set(rounds.map((r) => r.id));
  for (const id of memory.keys()) if (!liveIds.has(id)) memory.delete(id);
  for (const r of rounds) {
    const ids = await listRoomIdentitiesStrict(r.livekitRoom);
    if (ids === null) continue; // LiveKit unreachable: never read that as "everyone left"
    const state = r.state ?? memory.get(r.id) ?? { seenAt: null, emptySince: null };
    const action = decidePresence({ humans: humanIdentities(ids).length, state, now, graceMs });
    if (action.type === "none") continue;
    if (action.type === "present") {
      const next = { seenAt: action.seenAt, emptySince: null };
      if (r.state) await writeState(r.id, { roomSeenAt: action.seenAt, roomEmptySince: null }, next);
      else memory.set(r.id, next);
    } else if (action.type === "start_empty") {
      const next = { seenAt: state.seenAt, emptySince: action.emptySince };
      if (r.state) await writeState(r.id, { roomEmptySince: action.emptySince }, next);
      else memory.set(r.id, next);
    } else {
      // Look once more right before closing: someone may have joined since the first listing.
      const again = await listRoomIdentitiesStrict(r.livekitRoom);
      if (again === null || humanIdentities(again).length > 0) continue;
      const ended = await endLiveRound(r.id, r.livekitRoom, { reason: "auto_empty", emptySince: r.state ? action.emptySince : null }, deps);
      if (ended) {
        log.info(`Round 2 ${r.id} auto-closed: room empty for ${Math.round(graceMs / 1000)}s`);
        closed.push(r.id);
      }
    }
  }
  return closed;
}
