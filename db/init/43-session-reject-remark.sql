-- Optional recruiter reject note/tags on media-review Decline.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "rejectReason" text NULL,
  ADD COLUMN IF NOT EXISTS "rejectTags" text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.sessions."rejectReason" IS
  'Optional recruiter note when mediaReviewStatus = declined';
COMMENT ON COLUMN public.sessions."rejectTags" IS
  'Optional reject tags (preset ids and/or custom strings)';

NOTIFY pgrst, 'reload schema';
