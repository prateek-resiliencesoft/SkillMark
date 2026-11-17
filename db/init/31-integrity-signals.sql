-- ────────────────────────────────────────────────────────────
-- 31-integrity-signals.sql: video-interview integrity checks.
--
-- interviews."integrityChecksEnabled"    : device guard, lip-sync, answer timing,
--                                          reading pattern, extension detection
-- interviews."livenessChallengesEnabled" : random "turn head / cover face / smile" prompts
-- sessions."integritySignals"            : silent reviewer-only signals (never strikes);
--                                          warn-tier events stay in "antiCheatingLog"
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/31-integrity-signals.sql
-- Live deploy does not auto-run migrations — apply this file
-- on the target database, then reload PostgREST.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS "integrityChecksEnabled"    boolean NOT NULL DEFAULT false;
ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS "livenessChallengesEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE public.sessions   ADD COLUMN IF NOT EXISTS "integritySignals"          jsonb;

NOTIFY pgrst, 'reload schema';
