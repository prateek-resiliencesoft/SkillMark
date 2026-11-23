-- 42-auto-followup-decision-status.sql
-- Interview flag: auto WhatsApp/email follow-up when a session becomes ABANDONED (default off).
-- Candidate decision status from media Approve/Decline or follow-up send.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "autoLeftFollowup" boolean NOT NULL DEFAULT false;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "decisionStatus" text NOT NULL DEFAULT 'none';

-- Restrict to known values (ignore if constraint already exists).
DO $$
BEGIN
  ALTER TABLE public.candidates
    ADD CONSTRAINT candidates_decision_status_check
    CHECK ("decisionStatus" IN ('none', 'approved', 'rejected', 'followup_sent'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.interviews."autoLeftFollowup" IS
  'When true, ABANDONED sessions auto-send interview_incomplete_reminder. Default false (manual only).';

COMMENT ON COLUMN public.candidates."decisionStatus" IS
  'Recruiter outcome: none | approved | rejected | followup_sent';
