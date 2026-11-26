-- 48-auto-left-followup-default-on.sql
-- Abandon / left-early: auto-send interview_incomplete_reminder by default.

ALTER TABLE public.interviews
  ALTER COLUMN "autoLeftFollowup" SET DEFAULT true;

-- Turn on for existing interviews so abandon paths send without a manual settings flip.
UPDATE public.interviews
SET "autoLeftFollowup" = true
WHERE "autoLeftFollowup" = false;

COMMENT ON COLUMN public.interviews."autoLeftFollowup" IS
  'When true (default), ABANDONED sessions auto-send interview_incomplete_reminder with resume link. Off = manual send only.';
