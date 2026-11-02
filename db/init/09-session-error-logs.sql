-- ────────────────────────────────────────────────────────────
-- 09-session-error-logs.sql: per-session error log report
-- (AI/API errors, 429 rate limits, voice relay drops, client errors).
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/09-session-error-logs.sql
-- Never stores API keys — only the key source ("org" / "env") and slot number.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.session_error_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"  uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  -- ai | rate_limit | voice | tts_stt | report | client | anti_cheat | other
  category     text NOT NULL,
  -- info | warning | error | critical
  severity     text NOT NULL DEFAULT 'error',
  -- where it was raised: server/api/ai/chat, voice-relay, client, ...
  source       text NOT NULL,
  message      text NOT NULL,
  status       integer,
  code         text,
  context      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_session_error_logs_session
  ON public.session_error_logs ("sessionId", "createdAt");

GRANT ALL ON public.session_error_logs TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
