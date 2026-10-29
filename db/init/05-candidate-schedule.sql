-- ────────────────────────────────────────────────────────────
-- 05-candidate-schedule.sql: candidate scheduling and link expiry
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "scheduledAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz;
