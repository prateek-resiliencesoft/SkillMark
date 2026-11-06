-- 18: account pause/delete + one-time interview links (heartbeat expiry).
-- Idempotent: safe to re-run.

-- ── Accounts ────────────────────────────────────────────────
-- paused_at  : set → login blocked and live sessions rejected (reversible).
-- deleted_at : set → account scrubbed (tombstone). Row kept only as an opaque
--              FK anchor for retained org data; no email/password/profile left.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS paused_at  timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Archive of deleted accounts kept for future reference (audit, support, billing).
CREATE TABLE IF NOT EXISTS public.deleted_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"      uuid NOT NULL,              -- original id (now a scrubbed tombstone)
  email         text NOT NULL,
  name          text,
  "platformRole" text,
  "signedUpAt"  timestamptz,
  "deletedAt"   timestamptz NOT NULL DEFAULT now(),
  "deletedBy"   uuid,                       -- NULL = self-service
  "deletedByLabel" text NOT NULL DEFAULT 'self',
  organizations jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_email ON public.deleted_accounts (email);
GRANT ALL ON public.deleted_accounts TO anon, authenticated, service_role;

-- ── Interview sessions: one-time link + disconnect expiry ──
-- interviewBeganAt : candidate passed onboarding and the live interview started.
-- lastHeartbeatAt  : refreshed every few seconds by the open tab.
-- endReason        : why a session ended (COMPLETED | TAB_CLOSED | DISCONNECTED ...).
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "interviewBeganAt" timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "lastHeartbeatAt"  timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS "endReason"         text;

NOTIFY pgrst, 'reload schema';
