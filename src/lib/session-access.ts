/**
 * Bind public interview AI/voice routes to a real, in-progress session.
 * Knowing only an interview id is not enough — the session must exist,
 * belong to that interview, and still be open.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TENANT_COPY } from "@/server/tenant";

export type SessionAccessResult =
  | { ok: true; sessionId: string; interviewId: string }
  | { ok: false; status: number; error: string };

/**
 * Verify `sessionId` is an open session for `interviewId`.
 */
export async function assertActiveInterviewSession(
  sessionId: unknown,
  interviewId: unknown,
): Promise<SessionAccessResult> {
  if (typeof sessionId !== "string" || !sessionId) {
    return { ok: false, status: 400, error: TENANT_COPY.sessionInvalid };
  }
  if (typeof interviewId !== "string" || !interviewId) {
    return { ok: false, status: 400, error: TENANT_COPY.sessionInvalid };
  }

  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("id, interviewId, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.interviewId !== interviewId) {
    return { ok: false, status: 404, error: TENANT_COPY.sessionInvalid };
  }

  if (session.status !== "IN_PROGRESS") {
    return { ok: false, status: 409, error: TENANT_COPY.sessionEnded };
  }

  return {
    ok: true,
    sessionId: session.id as string,
    interviewId: session.interviewId as string,
  };
}
