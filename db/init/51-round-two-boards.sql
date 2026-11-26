-- Round 2 coding / whiteboard boards: what is open + the coding task (on the round),
-- and the candidate's latest snapshot per task (late-join replay, copilot context, report).
-- Idempotent: safe to re-run.
ALTER TABLE public.round_two_interviews
  ADD COLUMN IF NOT EXISTS "boardState" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.round_two_board_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"    uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  "taskId"        text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('coding', 'whiteboard')),
  task            jsonb NULL,
  language        text NULL,
  data            text NOT NULL CHECK (length(data) <= 200000),
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS round_two_board_snapshots_task_uidx
  ON public.round_two_board_snapshots ("roundTwoId", "taskId", kind);

ALTER TABLE public.round_two_board_snapshots ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.round_two_board_snapshots TO service_role;
