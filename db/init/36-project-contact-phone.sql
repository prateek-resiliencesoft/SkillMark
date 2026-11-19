-- ────────────────────────────────────────────────────────────
-- 36-project-contact-phone.sql: contact number per project, used in the automatic
-- "you left your interview" WhatsApp follow-up ({{2}} in left_interview_followup).
--
-- Stored in international format (e.g. +919876543210). NULL = not set; in that
-- case the follow-up is not sent.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS "supportPhone" text;

NOTIFY pgrst, 'reload schema';
