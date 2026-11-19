-- ────────────────────────────────────────────────────────────
-- 38-followup-error.sql: why the "you left your interview" WhatsApp follow-up was
-- NOT sent (e.g. "Add a contact number in Project settings"), so the dashboard can
-- explain it and offer a manual "Send follow-up".
--
-- "Sent" itself is tracked by 37-followup-sent.sql (followupSentAt / followupSentToken).
-- NULL = no problem recorded (sent, or never attempted).
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "followupError" text;

NOTIFY pgrst, 'reload schema';
