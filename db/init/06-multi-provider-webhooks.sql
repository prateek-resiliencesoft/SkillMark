-- ────────────────────────────────────────────────────────────
-- 06-multi-provider-webhooks.sql: Brevo, Multi-provider, Webhooks
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.org_integrations
  -- Brevo credentials
  ADD COLUMN IF NOT EXISTS "brevoApiKey" text,
  ADD COLUMN IF NOT EXISTS "brevoFromEmail" text,
  ADD COLUMN IF NOT EXISTS "brevoFromName" text,
  ADD COLUMN IF NOT EXISTS "brevoReplyTo" text,
  -- Default provider selection
  ADD COLUMN IF NOT EXISTS "defaultEmailProvider" text DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS "defaultWhatsappProvider" text DEFAULT 'resilio',
  -- Outbound Webhooks
  ADD COLUMN IF NOT EXISTS "outboundWebhookUrl" text,
  ADD COLUMN IF NOT EXISTS "outboundWebhookSecret" text,
  ADD COLUMN IF NOT EXISTS "outboundWebhookEvents" text[] DEFAULT ARRAY['candidate.invited', 'session.started', 'session.completed']::text[],
  -- Inbound Webhook Token
  ADD COLUMN IF NOT EXISTS "inboundWebhookSecret" text;

-- Record delivery provider on candidate
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "emailProvider" text,
  ADD COLUMN IF NOT EXISTS "whatsappProvider" text;
