-- Media review workflow: approve / decline / set-aside (15d).
-- Decline & expired set-aside clear object storage only — DB results stay.

DO $$ BEGIN
  CREATE TYPE public."MediaReviewStatus" AS ENUM (
    'pending',
    'approved',
    'declined',
    'set_aside'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "mediaReviewStatus" public."MediaReviewStatus" DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "mediaReviewAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "mediaExpiresAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "mediaClearedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "mediaStoragePrefix" text;

CREATE INDEX IF NOT EXISTS idx_sessions_media_expires
  ON public.sessions ("mediaExpiresAt")
  WHERE "mediaReviewStatus" = 'set_aside' AND "mediaClearedAt" IS NULL;
