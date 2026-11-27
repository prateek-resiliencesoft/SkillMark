-- Hiring role for an interview (e.g. Flutter Developer, HR, MERN). Shown on session lists.
-- Idempotent: safe to re-run.
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "jobRole" text NULL;

COMMENT ON COLUMN public.interviews."jobRole" IS 'Short hiring role title for this interview (AI or form).';
