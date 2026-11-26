-- Recruiter "Send new link": keep abandoned/expired attempts for audit, rotate
-- the invite token, and let the candidate start a fresh session.
-- Idempotent. Safe to re-run.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "revokedInviteTokens" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "candidateId" uuid REFERENCES public.candidates(id) ON DELETE SET NULL;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "supersededAt" timestamptz;

CREATE INDEX IF NOT EXISTS idx_sessions_candidate_id
  ON public.sessions USING btree ("candidateId");

-- Backfill the current candidate → session link so old attempts stay attributable
-- after sessionId is cleared for a retake.
UPDATE public.sessions s
SET "candidateId" = c.id
FROM public.candidates c
WHERE c."sessionId" = s.id
  AND s."candidateId" IS NULL;

COMMENT ON COLUMN public.candidates."revokedInviteTokens" IS
  'Previous invite tokens invalidated when a recruiter issues a fresh link';

COMMENT ON COLUMN public.sessions."candidateId" IS
  'Owning candidate, kept after sessionId on the candidate is cleared for a retake';

COMMENT ON COLUMN public.sessions."supersededAt" IS
  'Set when a recruiter issues a fresh invite link for this attempt';

CREATE OR REPLACE FUNCTION public.create_invite_session(
  p_invite_token text,
  p_mode_used public."InterviewMode" DEFAULT 'CHAT'::public."InterviewMode",
  p_current_question_id uuid DEFAULT NULL::uuid
) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_candidate candidates;
  v_interview interviews;
  v_session   sessions;
BEGIN
  SELECT * INTO v_candidate FROM candidates WHERE "inviteToken" = p_invite_token;
  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;

  IF v_candidate."sessionId" IS NOT NULL THEN
    SELECT * INTO v_session FROM sessions WHERE id = v_candidate."sessionId";
    RETURN row_to_json(v_session);
  END IF;

  SELECT * INTO v_interview FROM interviews WHERE id = v_candidate."interviewId";
  IF v_interview IS NULL THEN
    RAISE EXCEPTION 'Interview not found';
  END IF;

  INSERT INTO sessions ("interviewId", "participantName", "participantEmail", "modeUsed", "currentQuestionId", "candidateId")
  VALUES (v_interview.id, v_candidate.name, v_candidate.email, coalesce(p_mode_used, v_interview.mode), p_current_question_id, v_candidate.id)
  RETURNING * INTO v_session;

  UPDATE candidates SET "sessionId" = v_session.id, "updatedAt" = now() WHERE id = v_candidate.id;

  RETURN row_to_json(v_session);
END;
$$;

NOTIFY pgrst, 'reload schema';
