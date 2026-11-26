-- Sessions whose interview files and transcript were removed.
-- The row stays so History can show the candidate name and score.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "dataArchivedAt" timestamptz;

NOTIFY pgrst, 'reload schema';
