-- 29-public-api.sql: organization API keys + request log for the public API (/api/v1, /api/mcp).
-- Idempotent: safe to re-run. Keys stay hashed (SHA-256, see 03-integrations.sql);
-- the plaintext key is shown once and never stored.

-- Org-scoped key listing and lookups.
CREATE INDEX IF NOT EXISTS api_keys_org_idx
  ON public.api_keys ("organizationId", "createdAt" DESC);

-- Who in the org created the key (userId stays the acting user for access checks).
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS "createdBy" uuid;

-- Request log: response time and a per-key index for the usage list.
ALTER TABLE public.api_usage_logs ADD COLUMN IF NOT EXISTS "durationMs" integer;
CREATE INDEX IF NOT EXISTS api_usage_logs_key_idx
  ON public.api_usage_logs ("apiKeyId", "createdAt" DESC);

-- Only the server (service role) reads/writes these tables, same as api_keys.
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.api_usage_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.api_usage_logs_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
