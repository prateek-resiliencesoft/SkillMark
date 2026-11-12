-- Interviewer gender preference: org default + per-interview override.
-- Safe to re-run. Default FEMALE keeps the current Kore / female behaviour.

DO $$ BEGIN
  CREATE TYPE public."InterviewerGender" AS ENUM ('FEMALE', 'MALE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "defaultInterviewerGender" public."InterviewerGender" NOT NULL DEFAULT 'FEMALE';

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "aiGender" public."InterviewerGender" NOT NULL DEFAULT 'FEMALE';
