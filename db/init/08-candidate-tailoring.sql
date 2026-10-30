-- Per-candidate interview tailoring from resume skills.
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "tailorInterview" boolean NOT NULL DEFAULT true,
  -- [{ "text": "...", "skill": "..." }] generated at creation; blended into the interviewer prompt.
  ADD COLUMN IF NOT EXISTS "tailoredQuestions" jsonb;

NOTIFY pgrst, 'reload schema';
