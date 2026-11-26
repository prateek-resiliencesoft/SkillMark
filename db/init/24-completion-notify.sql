-- Completion WhatsApp notify: assignees on interviews, idempotency on sessions,
-- separate ResilioHub Meta template for completed-interview alerts.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS "completionNotifyMembers" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "completionNotifiedAt" timestamptz;

ALTER TABLE public.org_integrations
  ADD COLUMN IF NOT EXISTS "resilioCompletionTemplateName" text;

COMMENT ON COLUMN public.interviews."completionNotifyMembers" IS
  'JSON array of { userId, phone, name? } — org members notified on WhatsApp when a session completes';

COMMENT ON COLUMN public.sessions."completionNotifiedAt" IS
  'Set when completion WhatsApp notify was attempted (dedupe chat + voice complete paths)';

COMMENT ON COLUMN public.org_integrations."resilioCompletionTemplateName" IS
  'Approved Meta template name for interview-completed alerts (default: interview_completed)';

NOTIFY pgrst, 'reload schema';
