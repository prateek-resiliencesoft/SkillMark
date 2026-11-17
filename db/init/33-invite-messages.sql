-- ────────────────────────────────────────────────────────────
-- 33-invite-messages.sql: Persist rendered invite email/WhatsApp
-- bodies at send time for the candidate side panel.
-- Idempotent.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "inviteMessages" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.candidates."inviteMessages" IS
  'Snapshots of invite email/WhatsApp content saved when a send succeeds. Shape: { email?: {subject,text,sentAt,provider,to}, whatsapp?: {text,sentAt,provider,to,templateName?} }.';

NOTIFY pgrst, 'reload schema';
