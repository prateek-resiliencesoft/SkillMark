-- Round 2: tasks given to the candidate (status + submission), panel feedback fields, candidate experience feedback.
-- Builds on 51-round-two-boards.sql (one round_two_board_snapshots row per task). Idempotent: safe to re-run.
ALTER TABLE public.round_two_board_snapshots
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS "sentAt"      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "endedAt"     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "runOutput"   jsonb NULL,
  ADD COLUMN IF NOT EXISTS preview       text NULL;
ALTER TABLE public.round_two_board_snapshots DROP CONSTRAINT IF EXISTS round_two_board_snapshots_status_check;
ALTER TABLE public.round_two_board_snapshots
  ADD CONSTRAINT round_two_board_snapshots_status_check CHECK (status IN ('sent', 'working', 'submitted', 'ended'));
ALTER TABLE public.round_two_board_snapshots DROP CONSTRAINT IF EXISTS round_two_board_snapshots_preview_check;
ALTER TABLE public.round_two_board_snapshots
  ADD CONSTRAINT round_two_board_snapshots_preview_check CHECK (preview IS NULL OR length(preview) <= 500000);

ALTER TABLE public.round_two_scorecards
  ADD COLUMN IF NOT EXISTS "overallRating" smallint NULL,
  ADD COLUMN IF NOT EXISTS strengths text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS concerns text NOT NULL DEFAULT '';
ALTER TABLE public.round_two_scorecards DROP CONSTRAINT IF EXISTS round_two_scorecards_overall_rating_check;
ALTER TABLE public.round_two_scorecards
  ADD CONSTRAINT round_two_scorecards_overall_rating_check CHECK ("overallRating" IS NULL OR "overallRating" BETWEEN 1 AND 5);

ALTER TABLE public.round_two_interviews
  ADD COLUMN IF NOT EXISTS "candidateRating"     smallint NULL,
  ADD COLUMN IF NOT EXISTS "candidateFeedback"   text NULL,
  ADD COLUMN IF NOT EXISTS "candidateFeedbackAt" timestamptz NULL;
ALTER TABLE public.round_two_interviews DROP CONSTRAINT IF EXISTS round_two_interviews_candidate_rating_check;
ALTER TABLE public.round_two_interviews
  ADD CONSTRAINT round_two_interviews_candidate_rating_check CHECK ("candidateRating" IS NULL OR "candidateRating" BETWEEN 1 AND 5);
