/**
 * Issue a fresh invite link for a candidate (old token revoked, any open
 * session closed) and deliver it. Shared by the interviewer dashboard and the
 * platform admin panel; callers do their own access checks first.
 */
import type { Context } from "./context";
import { TRPCError } from "@trpc/server";
import { nanoid } from "@/lib/id";
import { expireIfStale } from "@/lib/session-link-server";
import { needsFreshInviteLink } from "@/lib/session-link";
import { inviteLink } from "./batch-access";
import { resolveInviteSchedule, sendCandidateInvite } from "./invite-delivery";

type Db = Context["supabase"];

export async function issueNewInviteLink(
  db: Db,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  organizationId: string,
  requested?: { email: boolean; whatsapp: boolean },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let session = (c as { session?: any }).session ?? null;
  if (session && typeof session === "object" && !Array.isArray(session)) {
    session = await expireIfStale(session);
  } else {
    session = null;
  }

  const status = session?.status as string | undefined;
  if (status === "COMPLETED" || status === "DISQUALIFIED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This interview is already finished. A new link cannot be issued.",
    });
  }
  if (
    !needsFreshInviteLink({
      session,
      expiresAt: (c.expiresAt as string | null) ?? null,
    })
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This link is still valid. Use Resend to send it again, or wait until the session expires.",
    });
  }

  const oldToken = (c.inviteToken as string | null) ?? null;
  const inviteToken = nanoid(12);
  const { expiresAt } = resolveInviteSchedule({ inviteSchedule: "immediate" });
  const revoked = Array.isArray(c.revokedInviteTokens)
    ? [...(c.revokedInviteTokens as string[])]
    : [];
  if (oldToken && !revoked.includes(oldToken)) revoked.push(oldToken);

  if (session?.id) {
    const now = new Date().toISOString();
    await db
      .from("sessions")
      .update({
        candidateId: c.id,
        supersededAt: now,
        ...(session.status === "IN_PROGRESS" ? { status: "ABANDONED", endReason: "DISCONNECTED" } : {}),
      })
      .eq("id", session.id);
  }

  const { data: updated, error } = await db
    .from("candidates")
    .update({
      inviteToken,
      expiresAt,
      scheduledAt: null,
      sessionId: null,
      revokedInviteTokens: revoked,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", c.id)
    .select("id, inviteToken, expiresAt")
    .single();
  if (error || !updated) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error?.message ?? "Could not issue a new invite link",
    });
  }

  const channels = requested ?? {
    email: !!c.email,
    whatsapp: !!c.phone,
  };
  const delivery = await sendCandidateInvite(db, organizationId, c.id, channels);

  return {
    inviteToken: updated.inviteToken as string,
    inviteLink: inviteLink(updated.inviteToken as string),
    expiresAt: updated.expiresAt as string | null,
    delivery,
  };
}
