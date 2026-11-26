-- ────────────────────────────────────────────────────────────
-- 30-candidate-feedback.sql: optional feedback a candidate leaves on the
-- thank-you screen (rating 1–5, quick tags, short comment). One per session.
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/30-candidate-feedback.sql
-- Live deploy does not auto-run migrations — apply this file on the target
-- database. Until then the feedback form stays hidden.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.candidate_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"      uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  "candidateId"    uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  "organizationId" uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  "interviewId"    uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags             text[] NOT NULL DEFAULT '{}',
  comment          text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  "userAgent"      text,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

-- One submission per session.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_feedback_session_key
  ON public.candidate_feedback ("sessionId");

CREATE INDEX IF NOT EXISTS candidate_feedback_org_created_idx
  ON public.candidate_feedback ("organizationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS candidate_feedback_created_idx
  ON public.candidate_feedback ("createdAt" DESC);

-- Server only (service role), same as api_usage_logs.
ALTER TABLE public.candidate_feedback ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.candidate_feedback TO service_role;

NOTIFY pgrst, 'reload schema';
