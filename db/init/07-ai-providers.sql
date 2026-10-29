-- Per-org AI provider API keys (encrypted ciphertext in jsonb values).
-- Shape: {
--   openai?: { apiKey },
--   gemini?: { apiKey },
--   nvidia?: { apiKey },
--   anthropic?: { apiKey },
--   custom?: { apiKey, baseUrl }
-- }
ALTER TABLE public.org_integrations
  ADD COLUMN IF NOT EXISTS "aiProviders" jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
