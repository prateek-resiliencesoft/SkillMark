-- Integrations: hashed API keys, interview forms, applications, API usage logs.
-- Idempotent: safe to re-run on an existing database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── API keys: store only a SHA-256 hash ────────────────────────────────
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS "keyHash" text;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS "keyPrefix" text;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS environment text DEFAULT 'live' NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scopes text[] DEFAULT '{*}'::text[] NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS "organizationId" uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS "revokedAt" timestamp with time zone;
ALTER TABLE public.api_keys ALTER COLUMN key DROP NOT NULL;
-- migrate any plaintext keys to hashes, then wipe the plaintext
UPDATE public.api_keys
   SET "keyHash" = encode(digest(key, 'sha256'), 'hex'),
       "keyPrefix" = left(key, 12)
 WHERE key IS NOT NULL AND "keyHash" IS NULL;
UPDATE public.api_keys SET key = NULL WHERE key IS NOT NULL AND "keyHash" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_keyhash_idx ON public.api_keys ("keyHash");

-- ── Interview forms ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.interview_forms (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "publicId" text NOT NULL UNIQUE,
    "organizationId" uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    "projectId" uuid REFERENCES public.projects(id) ON DELETE SET NULL,
    "userId" uuid NOT NULL,
    "interviewId" uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft','published','unpublished')),
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    "publishedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS interview_forms_org_idx ON public.interview_forms ("organizationId");

-- ── Applications (candidate submissions) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.applications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "publicId" text NOT NULL UNIQUE,
    "formId" uuid NOT NULL REFERENCES public.interview_forms(id) ON DELETE CASCADE,
    "organizationId" uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    "interviewId" uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
    "candidateId" uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
    "candidateName" text NOT NULL,
    "candidateEmail" text,
    "candidatePhone" text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    files jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'submitted' NOT NULL,
    source text DEFAULT 'api' NOT NULL,
    "apiKeyId" uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
    environment text DEFAULT 'live' NOT NULL,
    "submitterIp" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_form_idx ON public.applications ("formId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS applications_org_idx ON public.applications ("organizationId");

-- ── API usage logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id bigserial PRIMARY KEY,
    "organizationId" uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    "apiKeyId" uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
    method text NOT NULL,
    endpoint text NOT NULL,
    status integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS api_usage_logs_org_idx ON public.api_usage_logs ("organizationId", "createdAt" DESC);

GRANT ALL ON public.interview_forms, public.applications, public.api_usage_logs TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.api_usage_logs_id_seq TO anon, authenticated, service_role;
