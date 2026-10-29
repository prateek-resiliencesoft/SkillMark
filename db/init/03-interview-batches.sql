-- ────────────────────────────────────────────────────────────
-- 03-interview-batches.sql: bulk CV interviews + invite delivery
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/03-interview-batches.sql
-- ────────────────────────────────────────────────────────────

-- A batch groups the per-candidate interviews generated from a set of CVs.
CREATE TABLE IF NOT EXISTS public.interview_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  "projectId"  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  "userId"     uuid NOT NULL,
  -- Shared generation settings (role prompt, JD, channels, tone, ...).
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_batches_project ON public.interview_batches ("projectId", "createdAt" DESC);

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "batchId" uuid REFERENCES public.interview_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_interviews_batch ON public.interviews ("batchId") WHERE "batchId" IS NOT NULL;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "batchId" uuid REFERENCES public.interview_batches(id) ON DELETE CASCADE,
  -- Structured CV extraction (tech stack, experience, projects, review flags).
  ADD COLUMN IF NOT EXISTS profile jsonb,
  ADD COLUMN IF NOT EXISTS "emailStatus" text,
  ADD COLUMN IF NOT EXISTS "emailSentAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "whatsappStatus" text,
  ADD COLUMN IF NOT EXISTS "whatsappSentAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "lastSendError" text;
CREATE INDEX IF NOT EXISTS idx_candidates_batch ON public.candidates ("batchId") WHERE "batchId" IS NOT NULL;

-- Per-organization delivery settings. API keys are stored AES-GCM encrypted
-- (key derived from AUTH_SECRET) and never returned to the browser.
CREATE TABLE IF NOT EXISTS public.org_integrations (
  "organizationId"         uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  "resendApiKey"           text,
  "resendFrom"             text,
  "resendReplyTo"          text,
  "resilioApiKey"          text,
  "resilioBaseUrl"         text,
  "resilioTemplateName"    text,
  "resilioTemplateLanguage" text,
  -- { emailSubject, emailBody, whatsappBody }
  "messageTemplates"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt"              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS interview_batches_updated_at ON public.interview_batches;
CREATE TRIGGER interview_batches_updated_at BEFORE UPDATE ON public.interview_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS org_integrations_updated_at ON public.org_integrations;
CREATE TRIGGER org_integrations_updated_at BEFORE UPDATE ON public.org_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

NOTIFY pgrst, 'reload schema';
