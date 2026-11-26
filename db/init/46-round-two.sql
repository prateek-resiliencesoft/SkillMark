-- ────────────────────────────────────────────────────────────
-- 46-round-two.sql: Round 2 live human interviews (LiveKit room + AI copilot).
-- Approved candidates land on a watchlist; a round 2 has a host, invited
-- panel interviewers (org members or external), live transcript, notes,
-- AI copilot events, per-interviewer scorecards and an async report.
--
-- Idempotent:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/46-round-two.sql
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "watchlistedAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "watchlistDismissedAt" timestamptz NULL;

COMMENT ON COLUMN public.candidates."watchlistedAt" IS
  'Set when the candidate is approved after round 1; drives the round 2 watchlist';
COMMENT ON COLUMN public.candidates."watchlistDismissedAt" IS
  'Recruiter removed the candidate from the round 2 watchlist';

CREATE INDEX IF NOT EXISTS candidates_watchlisted_idx
  ON public.candidates ("watchlistedAt" DESC)
  WHERE "watchlistedAt" IS NOT NULL AND "watchlistDismissedAt" IS NULL;

CREATE TABLE IF NOT EXISTS public.round_two_interviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  "projectId"           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  "candidateId"         uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  "sourceSessionId"     uuid NULL REFERENCES public.sessions(id) ON DELETE SET NULL,
  "hostUserId"          uuid NOT NULL,
  title                 text NOT NULL,
  "scheduledAt"         timestamptz NULL,
  "durationMin"         integer NOT NULL DEFAULT 45 CHECK ("durationMin" BETWEEN 10 AND 240),
  status                text NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('draft', 'scheduled', 'live', 'ended', 'cancelled', 'no_show')),
  "livekitRoom"         text NOT NULL,
  "candidateTokenHash"  text NOT NULL,
  "candidateAdmittedAt" timestamptz NULL,
  "candidateConsentAt"  timestamptz NULL,
  "questionPlan"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "round1Context"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "liveSummary"         text NOT NULL DEFAULT '',
  "coveredQuestionIds"  text[] NOT NULL DEFAULT '{}',
  "aiTokensUsed"        integer NOT NULL DEFAULT 0,
  "reportStatus"        text NOT NULL DEFAULT 'none'
                          CHECK ("reportStatus" IN ('none', 'pending', 'generating', 'ready', 'failed')),
  "reportAttempts"      integer NOT NULL DEFAULT 0,
  "reportError"         text NULL,
  report                jsonb NULL,
  "recordingUrl"        text NULL,
  "startedAt"           timestamptz NULL,
  "endedAt"             timestamptz NULL,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS round_two_interviews_room_uidx
  ON public.round_two_interviews ("livekitRoom");
CREATE UNIQUE INDEX IF NOT EXISTS round_two_interviews_candidate_token_uidx
  ON public.round_two_interviews ("candidateTokenHash");
CREATE INDEX IF NOT EXISTS round_two_interviews_org_idx
  ON public.round_two_interviews ("organizationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS round_two_interviews_candidate_idx
  ON public.round_two_interviews ("candidateId");
CREATE INDEX IF NOT EXISTS round_two_interviews_report_idx
  ON public.round_two_interviews ("reportStatus")
  WHERE "reportStatus" IN ('pending', 'generating');

CREATE TABLE IF NOT EXISTS public.round_two_participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"      uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  "userId"          uuid NULL,
  email             text NOT NULL,
  name              text NULL,
  role              text NOT NULL DEFAULT 'interviewer'
                      CHECK (role IN ('host', 'interviewer', 'observer')),
  "inviteTokenHash" text NULL,
  status            text NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited', 'accepted', 'joined', 'left', 'revoked')),
  "joinedAt"        timestamptz NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS round_two_participants_email_uidx
  ON public.round_two_participants ("roundTwoId", lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS round_two_participants_token_uidx
  ON public.round_two_participants ("inviteTokenHash")
  WHERE "inviteTokenHash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS round_two_participants_user_idx
  ON public.round_two_participants ("userId");

CREATE TABLE IF NOT EXISTS public.round_two_transcript (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"    uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  "speakerRole"   text NOT NULL CHECK ("speakerRole" IN ('candidate', 'interviewer')),
  "participantId" text NOT NULL,
  "speakerName"   text NULL,
  text            text NOT NULL,
  "startMs"       integer NOT NULL DEFAULT 0,
  "endMs"         integer NOT NULL DEFAULT 0,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_two_transcript_room_idx
  ON public.round_two_transcript ("roundTwoId", "startMs");

CREATE TABLE IF NOT EXISTS public.round_two_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"    uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  "authorUserId"  uuid NOT NULL,
  "authorName"    text NULL,
  body            text NOT NULL,
  visibility      text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('private', 'shared')),
  kind            text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'chat')),
  "offsetMs"      integer NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_two_notes_room_idx
  ON public.round_two_notes ("roundTwoId", "createdAt");

CREATE TABLE IF NOT EXISTS public.round_two_ai_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"    uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('suggestions', 'flag', 'summary', 'style')),
  trigger         text NOT NULL DEFAULT 'turn' CHECK (trigger IN ('turn', 'manual', 'ask')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_two_ai_events_room_idx
  ON public.round_two_ai_events ("roundTwoId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS public.round_two_scorecards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roundTwoId"    uuid NOT NULL REFERENCES public.round_two_interviews(id) ON DELETE CASCADE,
  "userId"        uuid NOT NULL,
  "userName"      text NULL,
  scores          jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation  text NULL
                    CHECK (recommendation IS NULL OR recommendation IN
                      ('strong_no', 'no', 'lean_no', 'lean_yes', 'yes', 'strong_yes')),
  comments        text NOT NULL DEFAULT '',
  "submittedAt"   timestamptz NULL,
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS round_two_scorecards_user_uidx
  ON public.round_two_scorecards ("roundTwoId", "userId");

ALTER TABLE public.round_two_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_two_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_two_transcript ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_two_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_two_ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_two_scorecards ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.round_two_interviews TO service_role;
GRANT ALL ON public.round_two_participants TO service_role;
GRANT ALL ON public.round_two_transcript TO service_role;
GRANT ALL ON public.round_two_notes TO service_role;
GRANT ALL ON public.round_two_ai_events TO service_role;
GRANT ALL ON public.round_two_scorecards TO service_role;

NOTIFY pgrst, 'reload schema';
