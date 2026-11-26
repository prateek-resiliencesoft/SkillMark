/**
 * Bind public interview AI/voice routes to a real, in-progress session.
 * Knowing only an interview id (or a session UUID) is not enough — the session
 * must exist, belong to that interview, still be open, and the caller must hold
 * the session capability cookie (src/lib/session-capability.ts).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  readCapabilityFromCookieHeader,
  readSessionCapabilityCookie,
  requestHasSessionCapability,
  sessionCapabilityOk,
} from "@/lib/session-capability";
import { inviteExpiredForSession, type CandidateWriteSession } from "@/lib/session-link";
import { TENANT_COPY } from "@/server/tenant";

export type SessionAccessResult =
  | { ok: true; sessionId: string; interviewId: string }
  | { ok: false; status: number; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Columns the capability + live-window checks need. */
export const CANDIDATE_SESSION_GATE_COLUMNS =
  `id, interviewId, candidateId, status, supersededAt, capabilityRequired, interviewBeganAt, lastHeartbeatAt, lastActivityAt, completedAt, endReason`;

export type CandidateSessionRow = CandidateWriteSession & {
  id: string;
  interviewId?: string | null;
  candidateId?: string | null;
  capabilityRequired?: boolean | null;
};

/**
 * Candidate endpoints are only called same-origin (fetch / sendBeacon). Reject
 * cross-site browsers (Sec-Fetch-Site / Origin) and, for JSON routes, any body
 * that is not application/json (blocks text/plain "simple" CSRF posts).
 */
export function rejectCrossSiteRequest(req: Request, opts: { json?: boolean } = {}): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
      .flatMap((v) => (v ? v.split(",") : []))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    try {
      hosts.push(new URL(req.url).host.toLowerCase());
    } catch {
      /* relative url in tests */
    }
    if (!originHost || !hosts.includes(originHost)) {
      return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
    }
  }
  if (opts.json) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
  }
  return null;
}

/** The linked invite's deadline (null for public-link sessions or no deadline). */
export async function loadInviteForSession(
  candidateId: string | null | undefined,
): Promise<{ expiresAt: string | null; sessionId: string | null; inviteToken: string | null } | null> {
  if (!candidateId) return null;
  const { data } = await supabaseAdmin
    .from("candidates")
    .select("expiresAt, sessionId, inviteToken")
    .eq("id", candidateId)
    .maybeSingle();
  if (!data) return null;
  return {
    expiresAt: (data.expiresAt as string | null) ?? null,
    sessionId: (data.sessionId as string | null) ?? null,
    inviteToken: (data.inviteToken as string | null) ?? null,
  };
}

export type CandidateSessionGate =
  | {
      ok: true;
      session: CandidateSessionRow & Record<string, unknown>;
      invite: { expiresAt: string | null; sessionId: string | null; inviteToken: string | null } | null;
    }
  | { ok: false; response: Response };

/**
 * Load a candidate session for a lifecycle / media route and require the
 * capability cookie. `columns` must include CANDIDATE_SESSION_GATE_COLUMNS.
 */
export async function gateCandidateSession(
  req: Request,
  sessionId: unknown,
  columns: string = CANDIDATE_SESSION_GATE_COLUMNS,
): Promise<CandidateSessionGate> {
  if (!isSessionId(sessionId)) {
    return { ok: false, response: NextResponse.json({ error: "Missing sessionId" }, { status: 400 }) };
  }
  const { data: session, error } = await supabaseAdmin.from("sessions").select(columns).eq("id", sessionId).maybeSingle();
  if (error) return { ok: false, response: NextResponse.json({ error: "Session unavailable" }, { status: 503 }) };
  if (!session) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const row = session as unknown as CandidateSessionRow & Record<string, unknown>;
  if (!requestHasSessionCapability(req, row)) {
    return { ok: false, response: NextResponse.json({ error: TENANT_COPY.sessionInvalid }, { status: 403 }) };
  }
  return { ok: true, session: row, invite: await loadInviteForSession(row.candidateId) };
}

/**
 * Verify `sessionId` is an open session for `interviewId` and the caller holds
 * its capability. Pass `req` from Route Handlers; without it the cookie is read
 * through next/headers.
 */
export async function assertActiveInterviewSession(
  sessionId: unknown,
  interviewId: unknown,
  opts: { req?: Request } = {},
): Promise<SessionAccessResult> {
  if (typeof sessionId !== "string" || !sessionId) {
    return { ok: false, status: 400, error: TENANT_COPY.sessionInvalid };
  }
  if (typeof interviewId !== "string" || !interviewId) {
    return { ok: false, status: 400, error: TENANT_COPY.sessionInvalid };
  }
  if (!isSessionId(sessionId)) {
    return { ok: false, status: 404, error: TENANT_COPY.sessionInvalid };
  }

  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, interviewId, status, supersededAt, interviewBeganAt, candidateId, capabilityRequired")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.interviewId !== interviewId) {
    return { ok: false, status: 404, error: TENANT_COPY.sessionInvalid };
  }

  const token = opts.req
    ? readCapabilityFromCookieHeader(opts.req.headers.get("cookie"), sessionId)
    : await readSessionCapabilityCookie(sessionId).catch(() => null);
  if (!sessionCapabilityOk(session as { id: string; capabilityRequired?: boolean | null }, token)) {
    return { ok: false, status: 403, error: TENANT_COPY.sessionInvalid };
  }

  if (session.status !== "IN_PROGRESS" || session.supersededAt) {
    return { ok: false, status: 409, error: TENANT_COPY.sessionEnded };
  }

  const invite = await loadInviteForSession(session.candidateId as string | null);
  if (invite && inviteExpiredForSession(session as { interviewBeganAt?: string | null }, invite.expiresAt)) {
    return { ok: false, status: 409, error: TENANT_COPY.sessionEnded };
  }

  return {
    ok: true,
    sessionId: session.id as string,
    interviewId: session.interviewId as string,
  };
}
