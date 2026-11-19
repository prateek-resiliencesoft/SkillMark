-- ────────────────────────────────────────────────────────────
-- 37-followup-sent.sql: dedupe for the "you left your interview" WhatsApp follow-up.
--
-- The follow-up is claimed atomically (UPDATE ... WHERE "followupSentToken" IS DISTINCT
-- FROM the current inviteToken) before sending, so it goes out at most once per candidate
-- per invite link. A rotated / re-issued link has a new inviteToken and may get one again.
-- A failed send clears the claim so a later abandon can retry.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "followupSentAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "followupSentToken" text;

NOTIFY pgrst, 'reload schema';
