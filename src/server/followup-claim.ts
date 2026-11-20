/**
 * Atomic once-per-invite claim for the left-interview WhatsApp follow-up.
 * Pure (no server-only import) so it can be unit-tested with a fake client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FollowupDb { from: (table: string) => any }

export type ClaimResult = "claimed" | "already-sent" | "unsupported" | "error";

const MISSING_COLUMN_CODE = /^(42703|PGRST204)$/;
const SAFE_TOKEN = /^[\w-]+$/;

/** Only a genuinely absent followup column means migration 37 is missing. */
function isMissingFollowupColumn(error: { code?: string; message?: string }): boolean {
  return MISSING_COLUMN_CODE.test(String(error.code ?? "")) && /followupSent/.test(String(error.message ?? ""));
}

/**
 * Atomic claim: succeeds (returns a row) only when the stored token differs from the current
 * inviteToken, so concurrent / repeated abandons send at most once per link.
 * Two single-filter conditional UPDATEs (never-claimed, then claimed for an older token):
 * PostgREST 12.2 rejects an UPDATE that carries an `or=(…)` filter with 42703 on any column.
 * A concurrent caller's UPDATE re-checks its WHERE after our row lock, so it matches neither.
 * "unsupported" = migration 37 not applied: caller must skip (never send un-deduped paid messages).
 */
export async function claimFollowup(db: FollowupDb, candidateId: string, inviteToken: string): Promise<ClaimResult> {
  if (!SAFE_TOKEN.test(inviteToken)) return "error";
  const patch = { followupSentAt: new Date().toISOString(), followupSentToken: inviteToken };
  const attempts = [
    (q: ReturnType<FollowupDb["from"]>) => q.is("followupSentToken", null),
    (q: ReturnType<FollowupDb["from"]>) => q.neq("followupSentToken", inviteToken),
  ];
  for (const narrow of attempts) {
    const { data, error } = await narrow(
      db.from("candidates").update(patch).eq("id", candidateId).eq("inviteToken", inviteToken),
    ).select("id");
    if (error) return isMissingFollowupColumn(error) ? "unsupported" : "error";
    if (Array.isArray(data) && data.length > 0) return "claimed";
  }
  return "already-sent";
}

/** Undo a claim after a failed send so a later abandon can retry. Only clears our own claim. */
export async function releaseFollowup(db: FollowupDb, candidateId: string, inviteToken: string): Promise<void> {
  await db
    .from("candidates")
    .update({ followupSentAt: null, followupSentToken: null })
    .eq("id", candidateId)
    .eq("followupSentToken", inviteToken);
}
