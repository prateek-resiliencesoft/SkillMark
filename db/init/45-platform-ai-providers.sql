-- ────────────────────────────────────────────────────────────
-- 45-platform-ai-providers.sql: platform-wide LLM API keys for
-- superadmin AI triage / ops (when no org context). Encrypted
-- blobs same shape as org_integrations.aiProviders.
--
-- Idempotent:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/45-platform-ai-providers.sql
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_ai_providers (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "aiProviders"  jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_ai_providers (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_ai_providers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.platform_ai_providers TO service_role;

NOTIFY pgrst, 'reload schema';
