-- ────────────────────────────────────────────────────────────
-- 35-session-doubtful.sql: reviewer-only "doubtful" mark on a session.
--
-- A reviewer can flag a candidate as doubtful (suspected cheating) with a remark
-- so teammates see it before a manual round. Informational only: it does not
-- change scoring, status or any workflow.
--
-- Columns use the "integrity" prefix so redactSessionForCandidate() strips them
-- from anything a candidate can read.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "integrityDoubtfulAt"     timestamptz,
  ADD COLUMN IF NOT EXISTS "integrityDoubtfulRemark" text,
  ADD COLUMN IF NOT EXISTS "integrityDoubtfulBy"     text;

NOTIFY pgrst, 'reload schema';
