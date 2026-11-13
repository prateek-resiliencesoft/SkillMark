-- ────────────────────────────────────────────────────────────
-- 28-report-status.sql: track automatic report generation per
-- session so the report is built once, right after the session
-- ends, with retries and a background pick-up for missed ones.
--
-- reportStatus    : PENDING | GENERATING | READY | FAILED | SKIPPED
-- reportAttempts  : how many automatic attempts ran
-- reportStartedAt : when the current/last attempt started (stale lock check)
-- reportError     : last failure message (short)
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/28-report-status.sql
-- Live deploy does not auto-run migrations — apply this file
-- on the target database, then reload PostgREST.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "reportStatus"    text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "reportAttempts"  integer NOT NULL DEFAULT 0;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "reportStartedAt" timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "reportError"     text;

-- Existing sessions that already have a report.
UPDATE public.sessions
   SET "reportStatus" = 'READY'
 WHERE "reportStatus" IS NULL
   AND ((summary IS NOT NULL AND summary <> '') OR COALESCE(insights ? 'captureFailure', false));

CREATE INDEX IF NOT EXISTS idx_sessions_report_pending
  ON public.sessions (status, "reportStatus")
  WHERE summary IS NULL;

NOTIFY pgrst, 'reload schema';
