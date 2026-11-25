-- Round 2: live AI scoring suggestions + surfaced AI errors share round_two_ai_events.
-- Idempotent: safe to re-run.
ALTER TABLE public.round_two_ai_events DROP CONSTRAINT IF EXISTS round_two_ai_events_kind_check;
ALTER TABLE public.round_two_ai_events
  ADD CONSTRAINT round_two_ai_events_kind_check
  CHECK (kind IN ('suggestions', 'flag', 'summary', 'style', 'scores', 'error'));
