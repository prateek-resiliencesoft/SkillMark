import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  isPreflightEventStatus,
  isPreflightEventType,
  shouldDedupePreflightEvent,
  type DeviceInfo,
} from "@/lib/preflight";

const eventsTable = "session_preflight_events";

export type RecordPreflightInput = {
  candidateId?: string | null;
  sessionId?: string | null;
  inviteToken?: string | null;
  type: string;
  status: string;
  detail?: Record<string, unknown> | null;
  device?: DeviceInfo | Record<string, unknown> | null;
};

/**
 * Insert a preflight event (deduped) and bump the session's lastActivityAt /
 * preflightStep. Safe to call from the public API and from invite handlers.
 */
export async function recordPreflightEvent(
  input: RecordPreflightInput,
): Promise<{ ok: true; deduped: boolean } | { ok: false; error: string }> {
  if (!isPreflightEventType(input.type) || !isPreflightEventStatus(input.status)) {
    return { ok: false, error: "Invalid event" };
  }

  const candidateId = input.candidateId ?? null;
  const sessionId = input.sessionId ?? null;
  const inviteToken = input.inviteToken ?? null;
  if (!candidateId && !sessionId && !inviteToken) {
    return { ok: false, error: "Missing session" };
  }

  // Heartbeats only refresh activity — don't fill the event log.
  if (input.type === "heartbeat") {
    if (sessionId) await touchSession(sessionId, null, input.device);
    return { ok: true, deduped: true };
  }

  const last = await findLastSame(input.type, input.status, { candidateId, sessionId, inviteToken });
  if (shouldDedupePreflightEvent(input.type, input.status, last)) {
    if (sessionId) await touchSession(sessionId, input.type, input.device);
    return { ok: true, deduped: true };
  }

  const row = {
    candidateId,
    sessionId,
    inviteToken,
    type: input.type,
    status: input.status,
    detail: input.detail ?? {},
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabaseAdmin.from(eventsTable) as any).insert(row);
  if (error) {
    // Unique link_opened index: treat conflict as a successful dedupe.
    if (String(error.code) === "23505" && input.type === "link_opened") {
      if (sessionId) await touchSession(sessionId, input.type, input.device);
      return { ok: true, deduped: true };
    }
    return { ok: false, error: "Could not record event" };
  }

  if (sessionId) await touchSession(sessionId, input.type === "error" ? null : input.type, input.device);
  return { ok: true, deduped: false };
}

async function findLastSame(
  type: string,
  status: string,
  ids: { candidateId: string | null; sessionId: string | null; inviteToken: string | null },
): Promise<{ status: string; createdAt: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabaseAdmin.from(eventsTable) as any)
    .select("status, createdAt")
    .eq("type", type)
    .eq("status", status)
    .order("createdAt", { ascending: false })
    .limit(1);

  if (ids.inviteToken) q = q.eq("inviteToken", ids.inviteToken);
  else if (ids.sessionId) q = q.eq("sessionId", ids.sessionId);
  else if (ids.candidateId) q = q.eq("candidateId", ids.candidateId);

  const { data } = await q.maybeSingle();
  return data ? { status: data.status, createdAt: data.createdAt } : null;
}

async function touchSession(
  sessionId: string,
  step: string | null,
  device?: DeviceInfo | Record<string, unknown> | null,
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { lastActivityAt: now };
  if (step && step !== "heartbeat") patch.preflightStep = step;
  if (device && typeof device === "object") patch.preflightDevice = device;
  const { error } = await supabaseAdmin.from("sessions").update(patch).eq("id", sessionId);
  if (error && (patch.preflightStep || patch.preflightDevice)) {
    await supabaseAdmin.from("sessions").update({ lastActivityAt: now }).eq("id", sessionId);
  }
}

/** Resolve the invite token / in-progress session that is allowed to post events. */
export async function authorizePreflightSource(opts: {
  token?: string | null;
  sessionId?: string | null;
}): Promise<
  | { ok: true; candidateId: string | null; sessionId: string | null; inviteToken: string | null }
  | { ok: false; status: number; error: string }
> {
  const token = opts.token?.trim() || null;
  const sessionId = opts.sessionId?.trim() || null;
  if (!token && !sessionId) return { ok: false, status: 400, error: "Missing token" };

  if (token) {
    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id, sessionId, inviteToken")
      .eq("inviteToken", token)
      .maybeSingle();
    if (!candidate) return { ok: false, status: 404, error: "Invalid link" };

    let resolvedSession = sessionId || (candidate.sessionId as string | null);
    if (sessionId && candidate.sessionId && sessionId !== candidate.sessionId) {
      // Session id must belong to this invite (or be the linked session).
      const { data: session } = await supabaseAdmin
        .from("sessions")
        .select("id, candidateId, status")
        .eq("id", sessionId)
        .maybeSingle();
      const belongs =
        session &&
        (session.candidateId === candidate.id || session.id === candidate.sessionId);
      if (!belongs) return { ok: false, status: 403, error: "Invalid session" };
      resolvedSession = session.id;
    }
    return {
      ok: true,
      candidateId: candidate.id as string,
      sessionId: resolvedSession,
      inviteToken: candidate.inviteToken as string,
    };
  }

  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, status, interviewBeganAt, candidateId")
    .eq("id", sessionId!)
    .maybeSingle();
  if (!session) return { ok: false, status: 404, error: "Not found" };
  if (session.status !== "IN_PROGRESS") {
    return { ok: false, status: 409, error: "Session is no longer active" };
  }
  let inviteToken: string | null = null;
  if (session.candidateId) {
    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("id, inviteToken")
      .eq("id", session.candidateId)
      .maybeSingle();
    inviteToken = (candidate?.inviteToken as string | null) ?? null;
    return {
      ok: true,
      candidateId: (candidate?.id as string | null) ?? (session.candidateId as string | null),
      sessionId: session.id as string,
      inviteToken,
    };
  }
  return { ok: true, candidateId: null, sessionId: session.id as string, inviteToken: null };
}

export async function listPreflightEvents(candidateId: string): Promise<unknown[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin.from(eventsTable) as any)
      .select("id, candidateId, sessionId, inviteToken, type, status, detail, createdAt")
      .eq("candidateId", candidateId)
      .order("createdAt", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Like listPreflightEvents, but says whether the events table exists
 * (migration 27). `available: false` → the panel shows a note, not "Not yet".
 */
export async function listPreflightEventsWithStatus(
  candidateId: string,
): Promise<{ events: unknown[]; available: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin.from(eventsTable) as any)
      .select("id, candidateId, sessionId, inviteToken, type, status, detail, createdAt")
      .eq("candidateId", candidateId)
      .order("createdAt", { ascending: true });
    if (error) return { events: [], available: false };
    return { events: data ?? [], available: true };
  } catch {
    return { events: [], available: false };
  }
}
