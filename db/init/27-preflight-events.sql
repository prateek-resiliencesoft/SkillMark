-- ────────────────────────────────────────────────────────────
-- 27-preflight-events.sql: timestamped candidate setup events
-- recorded before the interview starts (link opened, consent,
-- camera/mic/screen, tour). In-interview tracking is unchanged.
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/27-preflight-events.sql
-- Live deploy does not auto-run migrations — apply this file
-- on the target database, then reload PostgREST.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.session_preflight_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidateId"  uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  "sessionId"    uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  "inviteToken"  text,
  type           text NOT NULL,
  status         text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_preflight_events_candidate
  ON public.session_preflight_events ("candidateId", "createdAt");

CREATE INDEX IF NOT EXISTS idx_session_preflight_events_session
  ON public.session_preflight_events ("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS idx_session_preflight_events_token
  ON public.session_preflight_events ("inviteToken", "createdAt");

-- One "link opened" row per invite token (reloads / retries reuse it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_preflight_events_link_opened
  ON public.session_preflight_events ("inviteToken")
  WHERE type = 'link_opened' AND "inviteToken" IS NOT NULL;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "preflightStep" text,
  ADD COLUMN IF NOT EXISTS "preflightDevice" jsonb;

COMMENT ON TABLE public.session_preflight_events IS
  'Pre-interview setup events (link opened, permissions, checks) keyed by candidate/session/invite token.';

GRANT ALL ON public.session_preflight_events TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
