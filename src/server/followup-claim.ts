/**
 * Atomic once-per-invite claim for the left-interview WhatsApp follow-up.
 * Pure (no server-only import) so it can be unit-tested with a fake client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FollowupDb { from: (table: string) => any }

export type ClaimResult = "claimed" | "already-sent" | "unsupported" | "error";

const MISSING_COLUMN = /followupSent|42703|PGRST204/;
const SAFE_TOKEN = /^[\w-]+$/;

/**
 * Single conditional UPDATE: succeeds (returns a row) only when the stored token differs
 * from the current inviteToken, so concurrent / repeated abandons send at most once per link.
 * "unsupported" = migration 37 not applied: caller must skip (never send un-deduped paid messages).
 */
export async function claimFollowup(db: FollowupDb, candidateId: string, inviteToken: string): Promise<ClaimResult> {
  if (!SAFE_TOKEN.test(inviteToken)) return "error"; // token is interpolated into a PostgREST filter
  const { data, error } = await db
    .from("candidates")
    .update({ followupSentAt: new Date().toISOString(), followupSentToken: inviteToken })
    .eq("id", candidateId)
    .eq("inviteToken", inviteToken)
    .or(`followupSentToken.is.null,followupSentToken.neq.${inviteToken}`)
    .select("id");
  if (error) return MISSING_COLUMN.test(`${error.code} ${error.message}`) ? "unsupported" : "error";
  return Array.isArray(data) && data.length > 0 ? "claimed" : "already-sent";
}

/** Undo a claim after a failed send so a later abandon can retry. Only clears our own claim. */
export async function releaseFollowup(db: FollowupDb, candidateId: string, inviteToken: string): Promise<void> {
  await db
    .from("candidates")
    .update({ followupSentAt: null, followupSentToken: null })
    .eq("id", candidateId)
    .eq("followupSentToken", inviteToken);
}
