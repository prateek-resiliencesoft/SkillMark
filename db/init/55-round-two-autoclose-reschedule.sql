-- Round 2: auto-close when the room stays empty, and reschedule history.
-- Builds on 46-round-two.sql. Idempotent: safe to re-run.
--   roomSeenAt      first time a candidate or panelist was seen in the LiveKit room (a round nobody entered is never auto-closed)
--   roomEmptySince  set while the room has no candidate/panelist; cleared when someone is back
--   endReason       why the round ended: 'host' (End round) | 'auto_empty' (everyone left)
--   rescheduledFromId / rescheduleNote  link a new attempt to the round it replaces
ALTER TABLE public.round_two_interviews
  ADD COLUMN IF NOT EXISTS "roomSeenAt"        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "roomEmptySince"    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "endReason"         text NULL,
  ADD COLUMN IF NOT EXISTS "rescheduledFromId" uuid NULL REFERENCES public.round_two_interviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rescheduleNote"    text NULL;
ALTER TABLE public.round_two_interviews DROP CONSTRAINT IF EXISTS round_two_interviews_end_reason_check;
ALTER TABLE public.round_two_interviews
  ADD CONSTRAINT round_two_interviews_end_reason_check CHECK ("endReason" IS NULL OR "endReason" IN ('host', 'auto_empty'));
ALTER TABLE public.round_two_interviews DROP CONSTRAINT IF EXISTS round_two_interviews_reschedule_note_check;
ALTER TABLE public.round_two_interviews
  ADD CONSTRAINT round_two_interviews_reschedule_note_check CHECK ("rescheduleNote" IS NULL OR length("rescheduleNote") <= 1000);
CREATE INDEX IF NOT EXISTS round_two_interviews_live_idx
  ON public.round_two_interviews (status)
  WHERE status = 'live';
