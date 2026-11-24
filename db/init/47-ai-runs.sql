-- AI reasoning runs: one row per LangGraph flow execution (question generation,
-- round 2 plan / copilot / report, round 1 summary). `steps` is the timeline the
-- app shows ("how the AI got here"); `traceId` links to the Langfuse trace.

CREATE TABLE IF NOT EXISTS public.ai_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NULL,
  flow             text NOT NULL,
  "subjectType"    text NULL,
  "subjectId"      text NULL,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  steps            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "traceId"        text NULL,
  tokens           integer NOT NULL DEFAULT 0,
  error            text NULL,
  "createdBy"      uuid NULL,
  "startedAt"      timestamptz NOT NULL DEFAULT now(),
  "endedAt"        timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ai_runs_subject_idx
  ON public.ai_runs ("subjectType", "subjectId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS ai_runs_started_idx
  ON public.ai_runs ("startedAt");

ALTER TABLE public.round_two_ai_events ADD COLUMN IF NOT EXISTS "runId" uuid NULL;

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ai_runs TO service_role;

NOTIFY pgrst, 'reload schema';
