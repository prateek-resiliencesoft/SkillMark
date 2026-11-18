-- ────────────────────────────────────────────────────────────
-- 34-interview-language.sql: Interview language setting.
--   interviews.language (already exists, default 'en'):
--     'en' English · 'hi' Hindi (Hinglish) · 'multi' Hindi + English,
--     the candidate chooses and can switch. Older values zh/es/fr still work.
--   sessions.language: the language the candidate chose / last switched to
--     ('en' | 'hi'); NULL means the interview's own language.
-- Idempotent.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.interviews
  ALTER COLUMN "language" SET DEFAULT 'en';

UPDATE public.interviews SET "language" = 'en' WHERE "language" IS NULL OR btrim("language") = '';

COMMENT ON COLUMN public.interviews."language" IS
  'Interview language: en (English), hi (Hindi, Hinglish transcripts), multi (Hindi + English, candidate chooses and can switch). Legacy: zh, es, fr.';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "language" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_language_check') THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_language_check CHECK ("language" IS NULL OR "language" IN ('en', 'hi'));
  END IF;
END $$;

COMMENT ON COLUMN public.sessions."language" IS
  'Language the candidate chose or last switched to (en | hi) in a multi-language interview; NULL = the interview language.';

NOTIFY pgrst, 'reload schema';
