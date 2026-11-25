-- 49-round-two-share-tokens.sql
-- Host-visible invite tokens so the room UI can show candidate + partner links
-- without rotating (invalidating) an already-sent candidate link.

ALTER TABLE public.round_two_interviews
  ADD COLUMN IF NOT EXISTS "candidateInviteToken" text NULL,
  ADD COLUMN IF NOT EXISTS "partnerInviteToken" text NULL,
  ADD COLUMN IF NOT EXISTS "partnerInviteTokenHash" text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS round_two_interviews_partner_token_uidx
  ON public.round_two_interviews ("partnerInviteTokenHash")
  WHERE "partnerInviteTokenHash" IS NOT NULL;

COMMENT ON COLUMN public.round_two_interviews."candidateInviteToken" IS
  'Plaintext candidate join token for host copy/share; hash remains source of truth for auth.';
COMMENT ON COLUMN public.round_two_interviews."partnerInviteToken" IS
  'Reusable panelist invite link token (any signed-in user can accept as interviewer).';
