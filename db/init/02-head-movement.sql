-- Head Movement Detection (anti-cheating). Idempotent; safe to re-run on an existing DB.
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "headMovementDetectionEnabled" boolean DEFAULT false NOT NULL;
ALTER TYPE public."SessionStatus" ADD VALUE IF NOT EXISTS 'DISQUALIFIED';
