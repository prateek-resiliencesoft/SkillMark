-- ────────────────────────────────────────────────────────────
-- 44-bug-triage.sql: AI bug triage — queue + semantic buckets + settings.
-- Cron worker clusters feedback + error logs and may open GitHub issues.
--
-- Idempotent:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/44-bug-triage.sql
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bug_buckets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bugKey"               text NOT NULL,
  title                  text NOT NULL,
  severity               text NOT NULL
                           CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  summary                text NOT NULL DEFAULT '',
  "githubIssueNumber"    integer,
  "githubIssueUrl"       text,
  "lastCommentedAt"      timestamptz,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bug_buckets_bug_key_uidx
  ON public.bug_buckets ("bugKey");

CREATE INDEX IF NOT EXISTS bug_buckets_severity_updated_idx
  ON public.bug_buckets (severity, "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS public.triage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL CHECK (source IN ('feedback', 'error_log')),
  "sourceId"      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  "bucketId"      uuid REFERENCES public.bug_buckets(id) ON DELETE SET NULL,
  error           text,
  attempts        integer NOT NULL DEFAULT 0,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "processedAt"   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS triage_events_source_uidx
  ON public.triage_events (source, "sourceId");

CREATE INDEX IF NOT EXISTS triage_events_status_created_idx
  ON public.triage_events (status, "createdAt");

CREATE INDEX IF NOT EXISTS triage_events_bucket_created_idx
  ON public.triage_events ("bucketId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.bug_triage_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled             boolean NOT NULL DEFAULT true,
  "errorThreshold"    integer NOT NULL DEFAULT 10 CHECK ("errorThreshold" >= 1),
  "noiseThreshold"    integer NOT NULL DEFAULT 50 CHECK ("noiseThreshold" >= 1),
  "windowDays"        integer NOT NULL DEFAULT 7 CHECK ("windowDays" BETWEEN 1 AND 90),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bug_triage_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bug_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bug_triage_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.bug_buckets TO service_role;
GRANT ALL ON public.triage_events TO service_role;
GRANT ALL ON public.bug_triage_settings TO service_role;

NOTIFY pgrst, 'reload schema';
