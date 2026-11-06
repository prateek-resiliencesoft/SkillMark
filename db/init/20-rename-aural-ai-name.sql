-- The interviewer introduces itself with interviews.aiName.
-- Fresh installs used to default that to the upstream name "Aural".
ALTER TABLE public.interviews
  ALTER COLUMN "aiName" SET DEFAULT 'ResilienceSoft Interview';

UPDATE public.interviews
SET "aiName" = 'ResilienceSoft Interview'
WHERE lower(btrim("aiName")) IN ('aural', 'aural ai', 'aural interviewer');

NOTIFY pgrst, 'reload schema';
